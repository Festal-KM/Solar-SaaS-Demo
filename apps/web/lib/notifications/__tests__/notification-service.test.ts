// Unit tests for NotificationService — T-07-02 / F-052 / docs/05 §6.7.
//
// Cases:
//   1. Normal creation: Notification + 2 Deliveries (IN_APP + EMAIL).
//   2. dedupKey collision within 1 hour → skip (no INSERT, skippedCount++).
//   3. NotificationPreference enabled=false for EMAIL → only IN_APP Delivery created.
//   4. EMAIL Delivery created → notification.send_email job enqueued.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @solar/contracts — preserve real implementations
// ---------------------------------------------------------------------------

vi.mock("@solar/contracts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@solar/contracts")>();
  return { ...real };
});

// ---------------------------------------------------------------------------
// Mock the email enqueue helper
// ---------------------------------------------------------------------------

const enqueueEmailMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/jobs/queue", () => ({
  enqueueEmail: (...args: unknown[]) => enqueueEmailMock(...args),
}));

import { NotificationService } from "../notification-service.js";

// ---------------------------------------------------------------------------
// tx mock helpers
// ---------------------------------------------------------------------------

const notificationFindFirstMock = vi.fn();
const notificationCreateMock = vi.fn();
const notificationPreferenceFindManyMock = vi.fn();
const notificationDeliveryCreateMock = vi.fn();

const tx = {
  notification: {
    findFirst: (...args: unknown[]) => notificationFindFirstMock(...args),
    create: (...args: unknown[]) => notificationCreateMock(...args),
  },
  notificationPreference: {
    findMany: (...args: unknown[]) => notificationPreferenceFindManyMock(...args),
  },
  notificationDelivery: {
    create: (...args: unknown[]) => notificationDeliveryCreateMock(...args),
  },
} as unknown as import("@solar/db").TxClient;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_INPUT = {
  type: "CONTRACT_CONTRACTED" as const,
  recipientUserIds: ["user_1"],
  tenantId: "tenant_ws_1",
  params: { customerName: "山田 太郎" },
};

function setupHappyPath() {
  notificationFindFirstMock.mockResolvedValue(null); // no dedup hit
  notificationPreferenceFindManyMock.mockResolvedValue([]); // no disabled prefs
  notificationCreateMock.mockResolvedValue({ id: "notif_1" });
  notificationDeliveryCreateMock
    .mockResolvedValueOnce({ id: "delivery_inapp_1" })
    .mockResolvedValueOnce({ id: "delivery_email_1" });
}

beforeEach(() => {
  notificationFindFirstMock.mockReset();
  notificationCreateMock.mockReset();
  notificationPreferenceFindManyMock.mockReset();
  notificationDeliveryCreateMock.mockReset();
  enqueueEmailMock.mockReset();
  enqueueEmailMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotificationService.fire", () => {
  // Case 1 — normal creation
  it("1. creates Notification + IN_APP + EMAIL Deliveries for a single recipient", async () => {
    setupHappyPath();

    const svc = new NotificationService();
    const result = await svc.fire(tx, BASE_INPUT);

    expect(result.notificationIds).toHaveLength(1);
    expect(result.notificationIds[0]).toBe("notif_1");
    expect(result.skippedCount).toBe(0);

    // Notification created once
    expect(notificationCreateMock).toHaveBeenCalledOnce();
    const createArg = notificationCreateMock.mock.calls[0]![0] as {
      data: { type: string; title: string; body: string };
    };
    expect(createArg.data.type).toBe("CONTRACT_CONTRACTED");
    expect(createArg.data.title).toContain("契約が成立しました");

    // Two Delivery rows: IN_APP and EMAIL
    expect(notificationDeliveryCreateMock).toHaveBeenCalledTimes(2);
    const channels = notificationDeliveryCreateMock.mock.calls.map(
      (call) => (call[0] as { data: { channel: string } }).data.channel,
    );
    expect(channels).toContain("IN_APP");
    expect(channels).toContain("EMAIL");
  });

  // Case 2 — dedupKey collision within 1 hour → skip
  it("2. dedupKey collision within 1 hour → skips recipient, no Notification created", async () => {
    // Simulate an existing Notification with the same dedupKey created recently
    notificationFindFirstMock.mockResolvedValue({ id: "existing_notif" });
    notificationPreferenceFindManyMock.mockResolvedValue([]);

    const svc = new NotificationService();
    const result = await svc.fire(tx, {
      ...BASE_INPUT,
      dedupKey: "CONTRACT_CONTRACTED:user_1:contract_abc",
    });

    expect(result.notificationIds).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationDeliveryCreateMock).not.toHaveBeenCalled();
  });

  // Case 3 — NotificationPreference enabled=false for EMAIL
  it("3. NotificationPreference disabled for EMAIL → only IN_APP Delivery created", async () => {
    notificationFindFirstMock.mockResolvedValue(null);
    // EMAIL is disabled for this user × type
    notificationPreferenceFindManyMock.mockResolvedValue([
      { channel: "EMAIL", enabled: false },
    ]);
    notificationCreateMock.mockResolvedValue({ id: "notif_2" });
    notificationDeliveryCreateMock.mockResolvedValueOnce({ id: "delivery_inapp_2" });

    const svc = new NotificationService();
    const result = await svc.fire(tx, BASE_INPUT);

    expect(result.notificationIds).toHaveLength(1);
    // Only one Delivery: IN_APP
    expect(notificationDeliveryCreateMock).toHaveBeenCalledOnce();
    const deliveryArg = notificationDeliveryCreateMock.mock.calls[0]![0] as {
      data: { channel: string };
    };
    expect(deliveryArg.data.channel).toBe("IN_APP");
  });

  // Case 4 — EMAIL job enqueued
  it("4. EMAIL Delivery creation triggers notification.send_email job enqueue", async () => {
    setupHappyPath();

    const svc = new NotificationService();
    await svc.fire(tx, BASE_INPUT);

    // enqueueEmail called exactly once (for the EMAIL delivery)
    expect(enqueueEmailMock).toHaveBeenCalledOnce();
    const [payload, opts] = enqueueEmailMock.mock.calls[0] as [
      { kind: string; deliveryId: string },
      { jobKey: string; maxAttempts: number },
    ];
    expect(payload.kind).toBe("delivery");
    expect(payload.deliveryId).toBe("delivery_email_1");
    expect(opts.jobKey).toContain("notification.send_email:");
    expect(opts.maxAttempts).toBe(3);
  });

  // Case 5 — multiple recipients, independent dedup per user
  it("5. multiple recipients processed independently — only deduped user is skipped", async () => {
    // user_1 has a dedup collision, user_2 does not
    notificationFindFirstMock
      .mockResolvedValueOnce({ id: "existing_notif" }) // user_1 → dedup hit
      .mockResolvedValueOnce(null); // user_2 → no hit
    notificationPreferenceFindManyMock.mockResolvedValue([]);
    notificationCreateMock.mockResolvedValue({ id: "notif_3" });
    notificationDeliveryCreateMock
      .mockResolvedValueOnce({ id: "d_inapp" })
      .mockResolvedValueOnce({ id: "d_email" });

    const svc = new NotificationService();
    const result = await svc.fire(tx, {
      ...BASE_INPUT,
      recipientUserIds: ["user_1", "user_2"],
      dedupKey: "CONTRACT_CONTRACTED:multi:contract_abc",
    });

    expect(result.notificationIds).toHaveLength(1); // only user_2 created
    expect(result.skippedCount).toBe(1); // user_1 skipped
  });

  // Case 6 — all channels disabled by preference → skipped
  it("6. all channels disabled by preference → recipient skipped, skippedCount++", async () => {
    notificationFindFirstMock.mockResolvedValue(null);
    // Both IN_APP and EMAIL disabled
    notificationPreferenceFindManyMock.mockResolvedValue([
      { channel: "IN_APP", enabled: false },
      { channel: "EMAIL", enabled: false },
    ]);

    const svc = new NotificationService();
    const result = await svc.fire(tx, BASE_INPUT);

    expect(result.notificationIds).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });
});
