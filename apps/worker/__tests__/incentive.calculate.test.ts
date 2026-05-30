// Unit tests for `incentive.calculate` graphile-worker task (T-06-05 / F-046).
//
// All DB calls are mocked via vi.mock('@solar/db') — no real Postgres required.
// We verify the task's idempotency guard and the normal calculation path.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---- mock @solar/db before importing the task ----
const mockTxContract = { findUnique: vi.fn() };
const mockTxGrossProfit = { findUnique: vi.fn() };
const mockTxIncentive = { findUnique: vi.fn(), upsert: vi.fn() };

vi.mock("@solar/db", () => ({
  rawPrisma: {},
  SYSTEM_TENANT_CONTEXT: { isSaasAdmin: true, relationshipIds: [], actorUserId: "system" },
  withTenant: vi.fn(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      contract: mockTxContract,
      grossProfit: mockTxGrossProfit,
      incentive: mockTxIncentive,
    }),
  ),
}));

import { incentiveCalculateTask } from "../src/tasks/incentive.calculate.js";

function fakeHelpers(jobId = "calc-job-1") {
  return {
    job: { id: jobId },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as Parameters<typeof incentiveCalculateTask>[1];
}

const BASE_CONTRACT = {
  id: "ctr_1",
  status: "CONTRACTED",
  isSelfHosted: false,
  ownerRelationshipId: "rel_1",
  incentiveRateSnapshot: "10.00",
  eventModeAtContract: "DEALER",
  contractDate: new Date("2026-03-15"),
};

describe("incentive.calculate task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxIncentive.findUnique.mockResolvedValue(null);
    mockTxIncentive.upsert.mockResolvedValue({ id: "inc_1" });
  });

  it("calculates and upserts Incentive with correct amount (FINALIZED) for a dealer contract", async () => {
    mockTxContract.findUnique.mockResolvedValue(BASE_CONTRACT);
    mockTxGrossProfit.findUnique.mockResolvedValue({ incentiveTargetProfit: "100000.00" });

    const helpers = fakeHelpers();
    await incentiveCalculateTask({ contractId: "ctr_1" }, helpers);

    expect(mockTxIncentive.upsert).toHaveBeenCalledOnce();
    const upsertArg = mockTxIncentive.upsert.mock.calls[0]?.[0];
    // 100000 * 10 / 100 = 10000
    expect(upsertArg?.create.amount).toBe("10000.00");
    expect(upsertArg?.create.status).toBe("FINALIZED");
    expect(helpers.logger.info).toHaveBeenCalled();
  });

  it("skips upsert when Incentive is already FINALIZED (idempotency)", async () => {
    mockTxContract.findUnique.mockResolvedValue(BASE_CONTRACT);
    mockTxIncentive.findUnique.mockResolvedValue({ status: "FINALIZED" });

    const helpers = fakeHelpers();
    await incentiveCalculateTask({ contractId: "ctr_1" }, helpers);

    expect(mockTxIncentive.upsert).not.toHaveBeenCalled();
    const logMsg = (helpers.logger.info as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(String(logMsg)).toContain("already FINALIZED");
  });

  it("upserts Incentive with status DRAFT for a JOINT event", async () => {
    mockTxContract.findUnique.mockResolvedValue({
      ...BASE_CONTRACT,
      eventModeAtContract: "JOINT",
    });
    mockTxGrossProfit.findUnique.mockResolvedValue({ incentiveTargetProfit: "50000.00" });

    const helpers = fakeHelpers();
    await incentiveCalculateTask({ contractId: "ctr_1" }, helpers);

    const upsertArg = mockTxIncentive.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.create.status).toBe("DRAFT");
    expect(upsertArg?.create.amount).toBe("5000.00");
  });

  it("upserts amount=0 and status=FINALIZED when incentiveTargetProfit is 0", async () => {
    mockTxContract.findUnique.mockResolvedValue(BASE_CONTRACT);
    mockTxGrossProfit.findUnique.mockResolvedValue({ incentiveTargetProfit: "0.00" });

    const helpers = fakeHelpers();
    await incentiveCalculateTask({ contractId: "ctr_1" }, helpers);

    const upsertArg = mockTxIncentive.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.create.amount).toBe("0.00");
    expect(upsertArg?.create.status).toBe("FINALIZED");
  });

  it("skips (no upsert) when contract has no ownerRelationshipId", async () => {
    mockTxContract.findUnique.mockResolvedValue({
      ...BASE_CONTRACT,
      ownerRelationshipId: null,
    });

    const helpers = fakeHelpers();
    await incentiveCalculateTask({ contractId: "ctr_1" }, helpers);

    expect(mockTxIncentive.upsert).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload (missing contractId)", async () => {
    await expect(
      incentiveCalculateTask({}, fakeHelpers()),
    ).rejects.toThrow();
  });
});
