// Unit tests for finalizeForContract — T-06-02 / F-046 / docs/05 §6.1.
//
// Six cases:
//   1. Self-hosted (isSelfHosted=true, no relationshipId) → empty array, no DB write.
//   2. Dealer event (DEALER mode) → amount=rate×targetProfit, status=FINALIZED.
//   3. Joint event (JOINT mode) → amount calculated, status=DRAFT.
//   4. Gross profit ≤ 0 → amount=0, status=FINALIZED.
//   5. Cancelled contract → amount=0, status=FINALIZED.
//   6. Rate unset (incentiveRateSnapshot=null) → amount=0, status=FINALIZED, warning logged.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @solar/contracts/logger so we can spy on getLogger's warn calls.
// (logger was split out of the main contracts index to keep node:async_hooks
// out of client bundles.)
vi.mock("@solar/contracts/logger", async (importOriginal) => {
  const real = await importOriginal<typeof import("@solar/contracts/logger")>();
  return {
    ...real,
    getLogger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  };
});

import * as solarContracts from "@solar/contracts/logger";
import { finalizeForContract } from "../incentive.js";

// ---------------------------------------------------------------------------
// tx mock helpers
// ---------------------------------------------------------------------------

const contractFindUniqueMock = vi.fn();
const grossProfitFindUniqueMock = vi.fn();
const incentiveUpsertMock = vi.fn();

const tx = {
  contract: { findUnique: (...args: unknown[]) => contractFindUniqueMock(...args) },
  grossProfit: { findUnique: (...args: unknown[]) => grossProfitFindUniqueMock(...args) },
  incentive: { upsert: (...args: unknown[]) => incentiveUpsertMock(...args) },
} as unknown as import("@solar/db").TxClient;

// Minimal upsert result that satisfies the return type mapping.
function makeUpsertResult(overrides?: Partial<{
  id: string;
  contractId: string;
  relationshipId: string;
  amount: { toString(): string };
  status: string;
  settledMonth: string;
}>) {
  return {
    id: "inc_1",
    contractId: "contract_1",
    relationshipId: "rel_a_x",
    amount: "5000.00",
    status: "FINALIZED",
    settledMonth: "2026-06",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Contract fixture builder
// ---------------------------------------------------------------------------

function makeContract(overrides?: Partial<{
  isSelfHosted: boolean;
  status: string;
  ownerRelationshipId: string | null;
  incentiveRateSnapshot: number | null;
  eventModeAtContract: string | null;
  contractDate: Date;
}>) {
  return {
    id: "contract_1",
    isSelfHosted: false,
    status: "CONTRACTED",
    ownerRelationshipId: "rel_a_x",
    incentiveRateSnapshot: 10,
    eventModeAtContract: "DEALER",
    contractDate: new Date("2026-06-15T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  contractFindUniqueMock.mockReset();
  grossProfitFindUniqueMock.mockReset();
  incentiveUpsertMock.mockReset();
  vi.mocked(solarContracts.getLogger).mockReturnValue({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof solarContracts.getLogger>);
});

// ---------------------------------------------------------------------------
// Case 1: Self-hosted with no relationshipId → no incentive record
// ---------------------------------------------------------------------------

describe("finalizeForContract", () => {
  it("1. self-hosted with no relationshipId → returns empty array, no upsert", async () => {
    contractFindUniqueMock.mockResolvedValue(
      makeContract({ isSelfHosted: true, ownerRelationshipId: null }),
    );

    const result = await finalizeForContract(tx, "contract_1", "actor_1");

    expect(result).toEqual([]);
    expect(incentiveUpsertMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Case 2: Dealer event → amount = rate × targetProfit, status = FINALIZED
  // ---------------------------------------------------------------------------

  it("2. dealer event → amount = rate × targetProfit, status = FINALIZED", async () => {
    contractFindUniqueMock.mockResolvedValue(
      makeContract({ eventModeAtContract: "DEALER" }),
    );
    // incentiveTargetProfit = 50_000 → amount = 50000 × 10% = 5000
    grossProfitFindUniqueMock.mockResolvedValue({ incentiveTargetProfit: 50_000 });
    incentiveUpsertMock.mockResolvedValue(makeUpsertResult({ amount: "5000.00", status: "FINALIZED" }));

    const result = await finalizeForContract(tx, "contract_1", "actor_1");

    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("FINALIZED");

    const upsertCall = incentiveUpsertMock.mock.calls[0]![0] as {
      create: { amount: string; status: string };
    };
    expect(upsertCall.create.amount).toBe("5000.00");
    expect(upsertCall.create.status).toBe("FINALIZED");
  });

  // ---------------------------------------------------------------------------
  // Case 3: Joint event → amount calculated but status = DRAFT
  // ---------------------------------------------------------------------------

  it("3. joint event → amount calculated, status = DRAFT", async () => {
    contractFindUniqueMock.mockResolvedValue(
      makeContract({ eventModeAtContract: "JOINT" }),
    );
    grossProfitFindUniqueMock.mockResolvedValue({ incentiveTargetProfit: 100_000 });
    incentiveUpsertMock.mockResolvedValue(makeUpsertResult({ amount: "10000.00", status: "DRAFT" }));

    await finalizeForContract(tx, "contract_1", "actor_1");

    const upsertCall = incentiveUpsertMock.mock.calls[0]![0] as {
      create: { amount: string; status: string };
    };
    expect(upsertCall.create.status).toBe("DRAFT");
    expect(upsertCall.create.amount).toBe("10000.00");
  });

  // ---------------------------------------------------------------------------
  // Case 4: Gross profit ≤ 0 → shouldSkipIncentive → amount=0, FINALIZED
  // ---------------------------------------------------------------------------

  it("4. gross profit ≤ 0 → amount=0, status=FINALIZED", async () => {
    contractFindUniqueMock.mockResolvedValue(makeContract());
    // incentiveTargetProfit = 0 → shouldSkipIncentive = true
    grossProfitFindUniqueMock.mockResolvedValue({ incentiveTargetProfit: 0 });
    incentiveUpsertMock.mockResolvedValue(makeUpsertResult({ amount: "0.00", status: "FINALIZED" }));

    await finalizeForContract(tx, "contract_1", "actor_1");

    const upsertCall = incentiveUpsertMock.mock.calls[0]![0] as {
      create: { amount: string; status: string };
    };
    expect(upsertCall.create.amount).toBe("0.00");
    expect(upsertCall.create.status).toBe("FINALIZED");
  });

  // ---------------------------------------------------------------------------
  // Case 5: Cancelled contract → amount=0, FINALIZED
  // ---------------------------------------------------------------------------

  it("5. cancelled contract → amount=0, status=FINALIZED", async () => {
    contractFindUniqueMock.mockResolvedValue(makeContract({ status: "CANCELLED" }));
    grossProfitFindUniqueMock.mockResolvedValue({ incentiveTargetProfit: 80_000 });
    incentiveUpsertMock.mockResolvedValue(makeUpsertResult({ amount: "0.00", status: "FINALIZED" }));

    await finalizeForContract(tx, "contract_1", "actor_1");

    const upsertCall = incentiveUpsertMock.mock.calls[0]![0] as {
      create: { amount: string; status: string };
    };
    expect(upsertCall.create.amount).toBe("0.00");
    expect(upsertCall.create.status).toBe("FINALIZED");
  });

  // ---------------------------------------------------------------------------
  // Case 6: Rate unset (incentiveRateSnapshot=null) → amount=0, FINALIZED, warning logged
  // ---------------------------------------------------------------------------

  it("6. rate unset → amount=0, status=FINALIZED, warning logged", async () => {
    const warnMock = vi.fn();
    vi.mocked(solarContracts.getLogger).mockReturnValue({
      warn: warnMock,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as ReturnType<typeof solarContracts.getLogger>);

    contractFindUniqueMock.mockResolvedValue(
      makeContract({ incentiveRateSnapshot: null, eventModeAtContract: "DEALER" }),
    );
    grossProfitFindUniqueMock.mockResolvedValue({ incentiveTargetProfit: 50_000 });
    incentiveUpsertMock.mockResolvedValue(makeUpsertResult({ amount: "0.00", status: "FINALIZED" }));

    await finalizeForContract(tx, "contract_1", "actor_1");

    const upsertCall = incentiveUpsertMock.mock.calls[0]![0] as {
      create: { amount: string; status: string };
    };
    expect(upsertCall.create.amount).toBe("0.00");
    expect(upsertCall.create.status).toBe("FINALIZED");
    expect(warnMock).toHaveBeenCalledOnce();
    expect(vi.mocked(solarContracts.getLogger)).toHaveBeenCalledWith(
      expect.objectContaining({ event: "incentive.rate_unset", contractId: "contract_1" }),
    );
  });
});
