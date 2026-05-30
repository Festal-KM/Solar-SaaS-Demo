// Unit tests for reminder.dispatch cron task (T-07-07 / docs/05 §5.2 §5.3).
//
// All DB calls are mocked via vi.mock('@solar/db') — no real Postgres required.
// quickAddJob from graphile-worker is also mocked.
//
// Test cases:
//   1. EVENT_PREFERENCE_DEADLINE — fires when deadlineAt is within 24h.
//   2. EVENT_PREFERENCE_DEADLINE — skips when deadlineAt is outside 24h window.
//   3. dedupKey collision — skips notification when same dedupKey exists.
//   4. CONSTRUCTION_UPCOMING — fires 7 days before plannedDate.
//   5. REPORT_PENDING — fires when day >= 25 and report is DRAFT.
//   6. REPORT_PENDING — skips when day < 25.
//   7. PRE_CALL_NOTIFICATION_PENDING — fires when notifiedAt + 24h < now.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock graphile-worker (quickAddJob)
// ---------------------------------------------------------------------------

const quickAddJobMock = vi.fn().mockResolvedValue(undefined);

vi.mock("graphile-worker", () => ({
  quickAddJob: (...args: unknown[]) => quickAddJobMock(...args),
}));

// ---------------------------------------------------------------------------
// Shared tx mock
// ---------------------------------------------------------------------------

const mockEventCandidate = { findMany: vi.fn() };
const mockEventCandidateVisibility = { findMany: vi.fn() };
const mockConstruction = { findMany: vi.fn() };
const mockContract = { findUnique: vi.fn() };
const mockApplication = { findMany: vi.fn() };
const mockPreCallNotification = { findMany: vi.fn() };
const mockPreCall = { findUnique: vi.fn() };
const mockMonthlyReport = { findMany: vi.fn() };
const mockUser = { findMany: vi.fn() };
const mockRelationship = { findUnique: vi.fn() };
const mockNotification = { findFirst: vi.fn(), create: vi.fn() };
const mockNotificationPreference = { findMany: vi.fn() };
const mockNotificationDelivery = { create: vi.fn() };

function makeTx() {
  return {
    eventCandidate: mockEventCandidate,
    eventCandidateVisibility: mockEventCandidateVisibility,
    construction: mockConstruction,
    contract: mockContract,
    application: mockApplication,
    preCallNotification: mockPreCallNotification,
    preCall: mockPreCall,
    monthlyReport: mockMonthlyReport,
    user: mockUser,
    relationship: mockRelationship,
    notification: mockNotification,
    notificationPreference: mockNotificationPreference,
    notificationDelivery: mockNotificationDelivery,
  };
}

vi.mock("@solar/db", () => ({
  SYSTEM_TENANT_CONTEXT: { isSaasAdmin: true, relationshipIds: [], actorUserId: "system" },
  withTenant: vi.fn(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn(makeTx()),
  ),
}));

// ---------------------------------------------------------------------------
// Import task after mocks are registered
// ---------------------------------------------------------------------------

import { reminderDispatchTask } from "../src/tasks/reminder.dispatch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeHelpers(jobId = "reminder-job-1") {
  return {
    job: { id: jobId },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as Parameters<typeof reminderDispatchTask>[1];
}

function setupEmptyDefaults() {
  mockEventCandidate.findMany.mockResolvedValue([]);
  mockEventCandidateVisibility.findMany.mockResolvedValue([]);
  mockConstruction.findMany.mockResolvedValue([]);
  mockContract.findUnique.mockResolvedValue(null);
  mockApplication.findMany.mockResolvedValue([]);
  mockPreCallNotification.findMany.mockResolvedValue([]);
  mockPreCall.findUnique.mockResolvedValue(null);
  mockMonthlyReport.findMany.mockResolvedValue([]);
  mockUser.findMany.mockResolvedValue([]);
  mockRelationship.findUnique.mockResolvedValue(null);
  mockNotification.findFirst.mockResolvedValue(null);
  mockNotification.create.mockResolvedValue({ id: "notif_1" });
  mockNotificationPreference.findMany.mockResolvedValue([]);
  mockNotificationDelivery.create.mockResolvedValue({ id: "delivery_1" });
  quickAddJobMock.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  // Restore DATABASE_URL for tests that need it.
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reminder.dispatch task", () => {
  // Case 1: EVENT_PREFERENCE_DEADLINE fires within 24h window
  it("1. fires EVENT_PREFERENCE_DEADLINE when deadlineAt is within next 24h", async () => {
    setupEmptyDefaults();

    const now = new Date();
    const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);

    mockEventCandidate.findMany.mockResolvedValueOnce([
      {
        id: "ec_1",
        wholesalerId: "ws_1",
        storeName: "テスト店舗",
        deadlineAt: in12h,
      },
    ]);
    mockEventCandidateVisibility.findMany.mockResolvedValueOnce([{ relationshipId: "rel_1" }]);

    // dealer resolution
    mockRelationship.findUnique.mockResolvedValue({ dealerId: "dl_1", wholesalerId: "ws_1" });
    mockUser.findMany.mockResolvedValue([{ id: "user_dl_1" }]);

    const helpers = fakeHelpers();
    await reminderDispatchTask({}, helpers);

    expect(mockNotification.create).toHaveBeenCalledOnce();
    const createArg = mockNotification.create.mock.calls[0]?.[0] as {
      data: { type: string; dedupKey: string };
    };
    expect(createArg.data.type).toBe("EVENT_PREFERENCE_DEADLINE");
    expect(createArg.data.dedupKey).toContain("EVENT_PREFERENCE_DEADLINE:ec_1:rel_1:");
    const logMsg = (helpers.logger.info as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(String(logMsg)).toContain("totalFired=1");
  });

  // Case 2: skips when deadlineAt is outside 24h window (no matching rows returned)
  it("2. skips EVENT_PREFERENCE_DEADLINE when no candidates in window", async () => {
    setupEmptyDefaults();
    // mockEventCandidate.findMany returns [] (default from setupEmptyDefaults)

    const helpers = fakeHelpers();
    await reminderDispatchTask({}, helpers);

    expect(mockNotification.create).not.toHaveBeenCalled();
    const logMsg = (helpers.logger.info as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(String(logMsg)).toContain("totalFired=0");
  });

  // Case 3: dedupKey collision prevents duplicate notification
  it("3. dedupKey collision skips notification creation", async () => {
    setupEmptyDefaults();

    const now = new Date();
    const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);

    mockEventCandidate.findMany.mockResolvedValueOnce([
      {
        id: "ec_2",
        wholesalerId: "ws_1",
        storeName: "重複テスト店舗",
        deadlineAt: in12h,
      },
    ]);
    mockEventCandidateVisibility.findMany.mockResolvedValueOnce([{ relationshipId: "rel_2" }]);
    mockRelationship.findUnique.mockResolvedValue({ dealerId: "dl_2", wholesalerId: "ws_1" });
    mockUser.findMany.mockResolvedValue([{ id: "user_dl_2" }]);

    // Simulate existing dedup notification
    mockNotification.findFirst.mockResolvedValue({ id: "existing_notif" });

    const helpers = fakeHelpers();
    await reminderDispatchTask({}, helpers);

    expect(mockNotification.create).not.toHaveBeenCalled();
    const logMsg = (helpers.logger.info as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(String(logMsg)).toContain("totalFired=0");
  });

  // Case 4: CONSTRUCTION_UPCOMING fires 7 days before plannedDate
  it("4. fires CONSTRUCTION_UPCOMING 7 days before plannedDate", async () => {
    setupEmptyDefaults();

    const now = new Date();
    const in7days = new Date(now);
    in7days.setUTCHours(0, 0, 0, 0);
    in7days.setUTCDate(in7days.getUTCDate() + 7);

    mockConstruction.findMany.mockResolvedValueOnce([
      {
        id: "cons_1",
        plannedDate: in7days,
        contractId: "ctr_1",
      },
    ]);
    mockContract.findUnique.mockResolvedValueOnce({
      wholesalerId: "ws_1",
      ownerRelationshipId: "rel_1",
    });
    mockRelationship.findUnique.mockResolvedValue({ dealerId: "dl_1", wholesalerId: "ws_1" });
    // ws admins and dealer admins each return one user
    mockUser.findMany
      .mockResolvedValueOnce([{ id: "ws_admin_1" }])  // wholesaler admins
      .mockResolvedValueOnce([{ id: "dl_admin_1" }]); // dealer admins

    mockNotification.create
      .mockResolvedValueOnce({ id: "notif_ws" })
      .mockResolvedValueOnce({ id: "notif_dl" });
    mockNotificationDelivery.create
      .mockResolvedValueOnce({ id: "d1" })
      .mockResolvedValueOnce({ id: "d2" })
      .mockResolvedValueOnce({ id: "d3" })
      .mockResolvedValueOnce({ id: "d4" });

    const helpers = fakeHelpers();
    await reminderDispatchTask({}, helpers);

    expect(mockNotification.create).toHaveBeenCalledTimes(2);
    const types = mockNotification.create.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    );
    expect(types).toEqual(["CONSTRUCTION_UPCOMING", "CONSTRUCTION_UPCOMING"]);
    const logMsg = (helpers.logger.info as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(String(logMsg)).toContain("totalFired=2");
  });

  // Case 5: REPORT_PENDING fires when day >= 25 and report is DRAFT
  it("5. fires REPORT_PENDING when day of month >= 25 and report is DRAFT", async () => {
    setupEmptyDefaults();

    // Force day-of-month to 25 by mocking Date
    const fakeNow = new Date("2026-05-25T10:00:00Z"); // day 25 in JST
    vi.setSystemTime(fakeNow);

    try {
      const currentMonth = fakeNow.toISOString().slice(0, 7);

      mockMonthlyReport.findMany.mockResolvedValueOnce([
        {
          id: "report_1",
          wholesalerId: "ws_1",
          relationshipId: "rel_1",
        },
      ]);
      mockRelationship.findUnique.mockResolvedValue({ dealerId: "dl_1", wholesalerId: "ws_1" });
      mockUser.findMany.mockResolvedValue([{ id: "dl_admin_1" }]);

      const helpers = fakeHelpers();
      await reminderDispatchTask({}, helpers);

      expect(mockNotification.create).toHaveBeenCalledOnce();
      const createArg = mockNotification.create.mock.calls[0]?.[0] as {
        data: { type: string; dedupKey: string };
      };
      expect(createArg.data.type).toBe("REPORT_PENDING");
      expect(createArg.data.dedupKey).toContain(`REPORT_PENDING:report_1:`);
      const logMsg = (helpers.logger.info as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
      expect(String(logMsg)).toContain("totalFired=1");
    } finally {
      vi.useRealTimers();
    }
  });

  // Case 6: REPORT_PENDING skips when day < 25
  it("6. skips REPORT_PENDING when day of month < 25", async () => {
    setupEmptyDefaults();

    // Force day-of-month to 24 (< 25)
    const fakeNow = new Date("2026-05-24T10:00:00Z");
    vi.setSystemTime(fakeNow);

    try {
      const helpers = fakeHelpers();
      await reminderDispatchTask({}, helpers);

      // monthlyReport.findMany should not be called (guarded by day check)
      expect(mockMonthlyReport.findMany).not.toHaveBeenCalled();
      expect(mockNotification.create).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // Case 7: PRE_CALL_NOTIFICATION_PENDING fires when notifiedAt + 24h < now
  it("7. fires PRE_CALL_NOTIFICATION_PENDING when notifiedAt is older than 24h", async () => {
    setupEmptyDefaults();

    mockPreCallNotification.findMany.mockResolvedValueOnce([
      {
        id: "pcn_1",
        relationshipId: "rel_1",
        preCallId: "pc_1",
      },
    ]);
    mockPreCall.findUnique.mockResolvedValueOnce({
      appointment: {
        customer: { wholesalerId: "ws_1", name: "田中 一郎" },
      },
    });
    mockRelationship.findUnique.mockResolvedValue({ dealerId: "dl_1", wholesalerId: "ws_1" });
    mockUser.findMany.mockResolvedValue([{ id: "ws_admin_1" }]);

    const helpers = fakeHelpers();
    await reminderDispatchTask({}, helpers);

    expect(mockNotification.create).toHaveBeenCalledOnce();
    const createArg = mockNotification.create.mock.calls[0]?.[0] as {
      data: { type: string; dedupKey: string };
    };
    expect(createArg.data.type).toBe("PRE_CALL_NOTIFICATION_PENDING");
    expect(createArg.data.dedupKey).toContain("PRE_CALL_NOTIFICATION_PENDING:pcn_1:ws:");
    const logMsg = (helpers.logger.info as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(String(logMsg)).toContain("totalFired=1");
  });

  // Case 8: Returns early when DATABASE_URL is not set
  it("8. returns early and logs error when DATABASE_URL is not set", async () => {
    delete process.env.DATABASE_URL;

    const helpers = fakeHelpers();
    await reminderDispatchTask({}, helpers);

    expect((helpers.logger.error as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(mockNotification.create).not.toHaveBeenCalled();
  });
});
