// Unit tests for monthly report comment + finalize/unlock Server Actions — T-06-08/T-06-09 / F-049/F-050.
//
// Cases:
//   1. submitCommentAction — DRAFT → SUBMITTED: sets status, submittedAt, comments.
//   2. reviewCommentAction — SUBMITTED → REVIEWED: sets status, reviewedAt, merges reviewComment.
//   3a. submitCommentAction on FINALIZED → ConflictError (409).
//   3b. reviewCommentAction on FINALIZED → ConflictError (409).
//   4. finalizeReportAction — REVIEWED → FINALIZED: sets status, finalizedAt, finalizedBy.
//   5. unlockReportAction — FINALIZED → REVIEWED: clears finalizedAt/By.
//   6. finalizeReportAction on non-REVIEWED → InvalidStateTransitionError (422).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, InvalidStateTransitionError } from "../../../../../lib/errors.js";
import { notificationService } from "@/lib/notifications/notification-service";

import type * as DbModule from "@solar/db";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/notifications/notification-service", () => ({
  notificationService: { fire: vi.fn().mockResolvedValue({ notificationIds: [], skippedCount: 0 }) },
}));

vi.mock("@/lib/notifications/recipient-helpers", () => ({
  resolveDealerAdmins: vi.fn().mockResolvedValue([]),
  resolveWholesalerAdmins: vi.fn().mockResolvedValue([]),
}));

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const auditLogCreateMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    monthlyReport: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreateMock(...args),
    },
  };
  return {
    ...actual,
    rawPrisma: {
      relationship: {
        findMany: (...args: unknown[]) => relationshipFindManyMock(...args),
      },
    },
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const {
  submitCommentAction,
  reviewCommentAction,
  finalizeReportAction,
  unlockReportAction,
} = await import("../actions.js");

// ---------------------------------------------------------------------------
// Shared session fixtures
// ---------------------------------------------------------------------------

const DEALER_ADMIN_SESSION = {
  user: {
    id: "u_dealer_admin",
    tenantId: "dl_a",
    tenantType: "DEALER",
    wholesalerId: null,
    dealerId: "dl_a",
    roles: ["DEALER_ADMIN"],
    isSaasAdmin: false,
  },
};

const WS_ADMIN_SESSION = {
  user: {
    id: "u_ws_admin",
    tenantId: "ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "ws_a",
    dealerId: null,
    roles: ["WHOLESALER_ADMIN"],
    isSaasAdmin: false,
  },
};

function makeDraftReport(overrides?: Partial<{
  id: string;
  status: string;
  wholesalerId: string;
  relationshipId: string | null;
  comments: Record<string, unknown> | null;
  targetMonth: string;
  aggregated: object;
}>) {
  return {
    id: "mr_1",
    status: "DRAFT",
    wholesalerId: "ws_a",
    relationshipId: "rel_1",
    comments: null,
    targetMonth: "2026-05",
    aggregated: {},
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditLogCreateMock.mockReset();
  auditLogCreateMock.mockResolvedValue({ id: BigInt(1) });
  vi.mocked(notificationService.fire).mockReset();
  vi.mocked(notificationService.fire).mockResolvedValue({ notificationIds: [], skippedCount: 0 });

  // Default: both sessions have rel_1 in scope.
  relationshipFindManyMock.mockResolvedValue([{ id: "rel_1" }]);
});

// ---------------------------------------------------------------------------
// Case 1: DRAFT → SUBMITTED
// ---------------------------------------------------------------------------

describe("submitCommentAction", () => {
  it("1. DRAFT → SUBMITTED: updates status, stores comments JSON, fires MONTHLY_REPORT_SUBMITTED", async () => {
    authMock.mockResolvedValue(DEALER_ADMIN_SESSION);
    findUniqueMock.mockResolvedValue(makeDraftReport());
    updateMock.mockResolvedValue({ id: "mr_1", status: "SUBMITTED" });

    // resolveWholesalerAdmins must return non-empty so fire() is invoked
    const { resolveWholesalerAdmins } = await import("@/lib/notifications/recipient-helpers");
    vi.mocked(resolveWholesalerAdmins).mockResolvedValue(["u_ws_admin"]);

    const result = await submitCommentAction({
      reportId: "mr_1",
      comments: {
        mainResults: "売上目標達成",
        issues: "雨天による稼働減",
      },
    });

    expect(result.status).toBe("SUBMITTED");

    const updateCall = updateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string; comments: unknown };
    };
    expect(updateCall.where.id).toBe("mr_1");
    expect(updateCall.data.status).toBe("SUBMITTED");
    expect(updateCall.data.comments).toMatchObject({ mainResults: "売上目標達成" });

    // Notification fired for MONTHLY_REPORT_SUBMITTED
    expect(notificationService.fire).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "MONTHLY_REPORT_SUBMITTED" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Case 2: SUBMITTED → REVIEWED
// ---------------------------------------------------------------------------

describe("reviewCommentAction", () => {
  it("2. SUBMITTED → REVIEWED: updates status and merges reviewComment", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    findUniqueMock.mockResolvedValue(
      makeDraftReport({
        status: "SUBMITTED",
        comments: { mainResults: "売上目標達成" },
      }),
    );
    updateMock.mockResolvedValue({ id: "mr_1", status: "REVIEWED" });

    const result = await reviewCommentAction({
      reportId: "mr_1",
      reviewComment: "確認しました。来月も頑張ってください。",
    });

    expect(result.status).toBe("REVIEWED");

    const updateCall = updateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string; comments: Record<string, unknown> };
    };
    expect(updateCall.data.status).toBe("REVIEWED");
    expect(updateCall.data.comments).toMatchObject({
      mainResults: "売上目標達成",
      reviewComment: "確認しました。来月も頑張ってください。",
    });
  });
});

// ---------------------------------------------------------------------------
// Case 3: FINALIZED → ConflictError (409)
// ---------------------------------------------------------------------------

describe("FINALIZED report lock", () => {
  it("3a. submitCommentAction on FINALIZED throws ConflictError", async () => {
    authMock.mockResolvedValue(DEALER_ADMIN_SESSION);
    findUniqueMock.mockResolvedValue(makeDraftReport({ status: "FINALIZED" }));

    await expect(
      submitCommentAction({ reportId: "mr_1", comments: {} }),
    ).rejects.toThrow(ConflictError);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("3b. reviewCommentAction on FINALIZED throws ConflictError", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    findUniqueMock.mockResolvedValue(
      makeDraftReport({ status: "FINALIZED" }),
    );

    await expect(
      reviewCommentAction({ reportId: "mr_1" }),
    ).rejects.toThrow(ConflictError);

    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 4: REVIEWED → FINALIZED
// ---------------------------------------------------------------------------

describe("finalizeReportAction", () => {
  it("4. REVIEWED → FINALIZED: sets status, finalizedAt, finalizedBy, fires INCENTIVE_FINALIZED", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    const frozenAt = new Date("2025-01-31T15:00:00.000Z");
    findUniqueMock.mockResolvedValue(
      makeDraftReport({ status: "REVIEWED", comments: { mainResults: "OK" } }),
    );
    updateMock.mockResolvedValue({
      id: "mr_1",
      status: "FINALIZED",
      finalizedAt: frozenAt,
    });

    // resolveDealerAdmins must return non-empty so fire() is invoked
    const { resolveDealerAdmins } = await import("@/lib/notifications/recipient-helpers");
    vi.mocked(resolveDealerAdmins).mockResolvedValue(["u_dealer_admin"]);

    const result = await finalizeReportAction({ reportId: "mr_1" });

    expect(result.status).toBe("FINALIZED");
    expect(result.finalizedAt).toBe(frozenAt.toISOString());

    const updateCall = updateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string; finalizedBy: string };
    };
    expect(updateCall.where.id).toBe("mr_1");
    expect(updateCall.data.status).toBe("FINALIZED");
    expect(updateCall.data.finalizedBy).toBe("u_ws_admin");

    // Notification fired for INCENTIVE_FINALIZED
    expect(notificationService.fire).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "INCENTIVE_FINALIZED" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Case 5: FINALIZED → REVIEWED (unlock)
// ---------------------------------------------------------------------------

describe("unlockReportAction", () => {
  it("5. FINALIZED → REVIEWED: clears finalizedAt and finalizedBy", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    findUniqueMock.mockResolvedValue(makeDraftReport({ status: "FINALIZED" }));
    updateMock.mockResolvedValue({ id: "mr_1", status: "REVIEWED" });

    const result = await unlockReportAction({
      reportId: "mr_1",
      reason: "集計値を再集計する必要があるため",
    });

    expect(result.status).toBe("REVIEWED");

    const updateCall = updateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string; finalizedAt: null; finalizedBy: null };
    };
    expect(updateCall.where.id).toBe("mr_1");
    expect(updateCall.data.status).toBe("REVIEWED");
    expect(updateCall.data.finalizedAt).toBeNull();
    expect(updateCall.data.finalizedBy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Case 6: non-REVIEWED → finalizeReportAction throws InvalidStateTransitionError
// ---------------------------------------------------------------------------

describe("finalizeReportAction on non-REVIEWED", () => {
  it("6. DRAFT → finalizeReportAction throws InvalidStateTransitionError", async () => {
    authMock.mockResolvedValue(WS_ADMIN_SESSION);
    findUniqueMock.mockResolvedValue(makeDraftReport({ status: "DRAFT" }));

    await expect(finalizeReportAction({ reportId: "mr_1" })).rejects.toThrow(
      InvalidStateTransitionError,
    );

    expect(updateMock).not.toHaveBeenCalled();
  });
});

// Ensure InvalidStateTransitionError is importable (compile-time assertion).
void InvalidStateTransitionError;
