// Unit tests for updateNotificationPreferencesAction — T-07-06 / F-052 / F-053.
//
// Cases:
//   1. Valid preferences are upserted (one per type × channel pair).
//   2. Invalid type or channel is rejected by Zod before any DB write.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock auth + tenancy so the action runs without a real Next.js context
// ---------------------------------------------------------------------------

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: {
      id: "user_test_1",
      roles: ["WHOLESALER_ADMIN"],
      tenantType: "WHOLESALER",
      tenantId: "tenant_ws_1",
      wholesalerId: "ws_1",
      isSaasAdmin: false,
    },
  }),
}));

vi.mock("@/lib/tenancy/context", () => ({
  getTenantContext: vi.fn().mockResolvedValue({
    actorUserId: "user_test_1",
    tenantId: "tenant_ws_1",
    wholesalerId: "ws_1",
    relationshipIds: [],
    isSaasAdmin: false,
  }),
}));

// ---------------------------------------------------------------------------
// Mock @solar/db — withTenant passes the tx mock to the handler
// ---------------------------------------------------------------------------

const upsertMock = vi.fn().mockResolvedValue({});

const txMock = {
  notificationPreference: {
    upsert: (...args: unknown[]) => upsertMock(...args),
    findMany: vi.fn().mockResolvedValue([]),
  },
};

vi.mock("@solar/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@solar/db")>();
  return {
    ...real,
    withTenant: (_ctx: unknown, fn: (tx: typeof txMock) => unknown) => fn(txMock),
    rawPrisma: { relationship: { findMany: vi.fn().mockResolvedValue([]) } },
  };
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { updateNotificationPreferencesAction } from "../actions.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("updateNotificationPreferencesAction", () => {
  beforeEach(() => {
    upsertMock.mockReset();
    upsertMock.mockResolvedValue({});
  });

  // Case 1 — valid preferences are upserted correctly
  it("1. valid preferences: upserts one row per type × channel pair", async () => {
    const input = {
      preferences: [
        { type: "CONTRACT_CONTRACTED" as const, channel: "IN_APP" as const, enabled: true },
        { type: "CONTRACT_CONTRACTED" as const, channel: "EMAIL" as const, enabled: false },
        { type: "MONTHLY_REPORT_SUBMITTED" as const, channel: "IN_APP" as const, enabled: true },
      ],
    };

    const result = await updateNotificationPreferencesAction(input);

    expect(result.updatedCount).toBe(3);
    expect(upsertMock).toHaveBeenCalledTimes(3);

    // Verify the EMAIL=false row was passed to upsert with enabled=false
    const emailCall = upsertMock.mock.calls.find(
      (call) =>
        (call[0] as { create: { channel: string } }).create.channel === "EMAIL",
    );
    expect(emailCall).toBeDefined();
    expect((emailCall![0] as { create: { enabled: boolean } }).create.enabled).toBe(false);
    expect((emailCall![0] as { update: { enabled: boolean } }).update.enabled).toBe(false);

    // Verify userId is set to the actor (not from input)
    const firstCall = upsertMock.mock.calls[0]![0] as {
      create: { userId: string };
    };
    expect(firstCall.create.userId).toBe("user_test_1");
  });

  // Case 2 — invalid type/channel is rejected before DB write
  it("2. invalid type or channel → Zod error, no DB write", async () => {
    const invalidInput = {
      preferences: [
        // "LINE" is not in the allowed channel enum for Phase 1
        { type: "CONTRACT_CONTRACTED", channel: "LINE", enabled: true },
      ],
    };

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateNotificationPreferencesAction(invalidInput as any),
    ).rejects.toThrow();

    // No upsert should have been called
    expect(upsertMock).not.toHaveBeenCalled();
  });

  // Additional case — invalid notification type is rejected
  it("3. invalid notification type → Zod error, no DB write", async () => {
    const invalidInput = {
      preferences: [{ type: "INVALID_TYPE", channel: "IN_APP", enabled: true }],
    };

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateNotificationPreferencesAction(invalidInput as any),
    ).rejects.toThrow();

    expect(upsertMock).not.toHaveBeenCalled();
  });
});
