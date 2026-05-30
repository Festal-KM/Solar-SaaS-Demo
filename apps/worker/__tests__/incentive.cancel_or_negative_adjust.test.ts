// Unit tests for `incentive.cancel_or_negative_adjust` graphile-worker task
// (T-06-05 / F-043).
//
// DB calls are mocked — no real Postgres required. Three scenarios:
//   1. Within deadline  → Incentive.status = CANCELLED
//   2. After deadline   → IncentiveAdjustment created + Incentive.status = NEGATIVE_ADJUSTED
//   3. Contract already CANCELLED → idempotency skip

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockTxContract = { findUnique: vi.fn(), update: vi.fn() };
const mockTxIncentive = { findMany: vi.fn(), update: vi.fn() };
const mockTxIncentiveAdjustment = { create: vi.fn() };
const mockTxContractCancellation = { findUnique: vi.fn(), create: vi.fn() };

vi.mock("@solar/db", () => ({
  SYSTEM_TENANT_CONTEXT: { isSaasAdmin: true, relationshipIds: [], actorUserId: "system" },
  withTenant: vi.fn(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      contract: mockTxContract,
      incentive: mockTxIncentive,
      incentiveAdjustment: mockTxIncentiveAdjustment,
      contractCancellation: mockTxContractCancellation,
    }),
  ),
}));

import { incentiveCancelOrNegativeAdjustTask } from "../src/tasks/incentive.cancel_or_negative_adjust.js";

function fakeHelpers(jobId = "cancel-job-1") {
  return {
    job: { id: jobId },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as Parameters<typeof incentiveCancelOrNegativeAdjustTask>[1];
}

const VALID_PAYLOAD = {
  contractId: "ctr_1",
  cancelledAt: "2026-03-10T10:00:00.000Z",
  cancelledByUserId: "usr_admin",
  reason: "キャンセル理由",
};

describe("incentive.cancel_or_negative_adjust task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxContract.update.mockResolvedValue({});
    mockTxIncentive.update.mockResolvedValue({});
    mockTxIncentiveAdjustment.create.mockResolvedValue({ id: "adj_1" });
    mockTxContractCancellation.findUnique.mockResolvedValue(null);
    mockTxContractCancellation.create.mockResolvedValue({ id: "cc_1" });
  });

  it("within deadline: marks Incentive as CANCELLED", async () => {
    // cancelDeadline is after cancelledAt
    mockTxContract.findUnique.mockResolvedValue({
      id: "ctr_1",
      status: "CONTRACTED",
      cancelDeadline: new Date("2026-03-18T00:00:00.000Z"),
    });
    mockTxIncentive.findMany.mockResolvedValue([
      { id: "inc_1", amount: "5000.00", settledMonth: "2026-03" },
    ]);

    const helpers = fakeHelpers();
    await incentiveCancelOrNegativeAdjustTask(VALID_PAYLOAD, helpers);

    expect(mockTxContract.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } }),
    );
    expect(mockTxIncentive.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }),
    );
    expect(mockTxIncentiveAdjustment.create).not.toHaveBeenCalled();
    expect(mockTxContractCancellation.create).toHaveBeenCalledOnce();
  });

  it("after deadline: creates NEGATIVE_AFTER_DEADLINE adjustment and marks NEGATIVE_ADJUSTED", async () => {
    // cancelDeadline is before cancelledAt
    mockTxContract.findUnique.mockResolvedValue({
      id: "ctr_1",
      status: "CONTRACTED",
      cancelDeadline: new Date("2026-03-05T00:00:00.000Z"),
    });
    mockTxIncentive.findMany.mockResolvedValue([
      { id: "inc_1", amount: "8000.00", settledMonth: "2026-03" },
    ]);

    const helpers = fakeHelpers();
    await incentiveCancelOrNegativeAdjustTask(VALID_PAYLOAD, helpers);

    expect(mockTxContract.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } }),
    );
    expect(mockTxIncentiveAdjustment.create).toHaveBeenCalledOnce();
    const adjArg = mockTxIncentiveAdjustment.create.mock.calls[0]?.[0];
    expect(adjArg?.data.kind).toBe("NEGATIVE_AFTER_DEADLINE");
    expect(adjArg?.data.beforeAmount).toBe("8000.00");
    expect(adjArg?.data.afterAmount).toBe("0.00");
    // appliedMonth should be 翌月 of 2026-03 → 2026-04
    expect(adjArg?.data.appliedMonth).toBe("2026-04");

    expect(mockTxIncentive.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "NEGATIVE_ADJUSTED" } }),
    );

    // negativeAdjustmentIds must contain the ID returned by incentiveAdjustment.create
    expect(mockTxContractCancellation.create).toHaveBeenCalledOnce();
    const ccArg = mockTxContractCancellation.create.mock.calls[0]?.[0];
    expect(ccArg?.data.negativeAdjustmentIds).toEqual(["adj_1"]);
  });

  it("skips processing when contract is already CANCELLED (idempotency)", async () => {
    mockTxContract.findUnique.mockResolvedValue({
      id: "ctr_1",
      status: "CANCELLED",
      cancelDeadline: new Date("2026-03-18T00:00:00.000Z"),
    });

    const helpers = fakeHelpers();
    await incentiveCancelOrNegativeAdjustTask(VALID_PAYLOAD, helpers);

    expect(mockTxContract.update).not.toHaveBeenCalled();
    expect(mockTxIncentive.update).not.toHaveBeenCalled();
    const logMsg = (helpers.logger.info as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(String(logMsg)).toContain("already CANCELLED");
  });

  it("rejects a malformed payload (missing reason)", async () => {
    const badPayload = { contractId: "ctr_1", cancelledAt: "2026-03-10T10:00:00.000Z", cancelledByUserId: "usr_x" };
    await expect(
      incentiveCancelOrNegativeAdjustTask(badPayload, fakeHelpers()),
    ).rejects.toThrow();
  });
});
