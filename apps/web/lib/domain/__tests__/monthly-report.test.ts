// Unit tests for aggregateForMonth — T-06-06 / F-048 / docs/05 §6.8.
//
// Four cases:
//   1. Normal aggregation — SELF + DEALER × 2 relations + ALL created
//   2. FINALIZED report is skipped (not overwritten)
//   3. Empty data → 0-value rows created for SELF and ALL
//   4. JOINT scope produces a per-relationship MonthlyReport

import { beforeEach, describe, expect, it, vi } from "vitest";

import { aggregateForMonth } from "../monthly-report.js";

// ---------------------------------------------------------------------------
// tx mock
// ---------------------------------------------------------------------------

const queryRawMock = vi.fn();
const findFirstMock = vi.fn();
const updateMock = vi.fn();
const createMock = vi.fn();

const tx = {
  $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  monthlyReport: {
    findFirst: (...args: unknown[]) => findFirstMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    create: (...args: unknown[]) => createMock(...args),
  },
} as unknown as import("@solar/db").TxClient;

// ---------------------------------------------------------------------------
// fixture helpers
// ---------------------------------------------------------------------------

function makeContractRow(
  id: string,
  contractAmount: number,
  projectProfit: number,
  scope: "SELF" | "DEALER" | "JOINT",
  relationshipId: string | null = null,
) {
  return {
    id,
    contract_amount: String(contractAmount),
    project_profit: String(projectProfit),
    scope,
    relationship_id: relationshipId,
  };
}

function makeIncentiveRow(
  relationshipId: string,
  amount: number,
  scope: "SELF" | "DEALER" | "JOINT",
) {
  return { relationship_id: relationshipId, amount: String(amount), scope };
}

function makeCreatedReport(
  id: string,
  scope: "SELF" | "DEALER" | "JOINT" | "ALL",
  relationshipId: string | null = null,
  status = "DRAFT",
) {
  return {
    id,
    wholesalerId: "ws_1",
    targetMonth: "2026-05",
    scope,
    relationshipId,
    status,
  };
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  queryRawMock.mockReset();
  findFirstMock.mockReset();
  updateMock.mockReset();
  createMock.mockReset();
});

// ---------------------------------------------------------------------------
// Case 1: Normal aggregation — SELF + DEALER (2 relationships) + ALL
// ---------------------------------------------------------------------------

describe("aggregateForMonth", () => {
  it("1. normal — SELF + DEALER (2 relationships) + ALL are created", async () => {
    queryRawMock
      .mockResolvedValueOnce([
        makeContractRow("c1", 1_000_000, 200_000, "SELF", null),
        makeContractRow("c2", 800_000, 150_000, "DEALER", "rel_a"),
        makeContractRow("c3", 600_000, 100_000, "DEALER", "rel_b"),
      ])
      .mockResolvedValueOnce([
        makeIncentiveRow("rel_a", 20_000, "DEALER"),
        makeIncentiveRow("rel_b", 10_000, "DEALER"),
      ]);

    // All findFirst calls return null → new reports created.
    findFirstMock.mockResolvedValue(null);

    createMock
      .mockResolvedValueOnce(makeCreatedReport("mr_self", "SELF"))
      .mockResolvedValueOnce(makeCreatedReport("mr_rel_a", "DEALER", "rel_a"))
      .mockResolvedValueOnce(makeCreatedReport("mr_rel_b", "DEALER", "rel_b"))
      .mockResolvedValueOnce(makeCreatedReport("mr_all", "ALL"));

    const results = await aggregateForMonth(tx, "ws_1", "2026-05");

    // 4 creates: SELF + DEALER×2 + ALL
    expect(createMock).toHaveBeenCalledTimes(4);
    expect(results).toHaveLength(4);

    const all = results.find((r) => r.scope === "ALL");
    expect(all).toBeDefined();
    expect(all?.relationshipId).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Case 2: FINALIZED report is skipped (not overwritten)
  // ---------------------------------------------------------------------------

  it("2. FINALIZED report is skipped (not overwritten)", async () => {
    queryRawMock
      .mockResolvedValueOnce([
        makeContractRow("c1", 500_000, 80_000, "DEALER", "rel_a"),
      ])
      .mockResolvedValueOnce([]);

    // SELF → null (new), DEALER/rel_a → FINALIZED, ALL → null (new).
    findFirstMock
      .mockResolvedValueOnce(null) // SELF
      .mockResolvedValueOnce({ id: "mr_finalized", status: "FINALIZED" }) // DEALER/rel_a
      .mockResolvedValueOnce(null); // ALL

    createMock
      .mockResolvedValueOnce(makeCreatedReport("mr_self", "SELF"))
      .mockResolvedValueOnce(makeCreatedReport("mr_all", "ALL"));

    const results = await aggregateForMonth(tx, "ws_1", "2026-05");

    // Only SELF and ALL are created; DEALER/rel_a is skipped.
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(updateMock).not.toHaveBeenCalled();

    const finalized = results.find((r) => r.status === "FINALIZED");
    expect(finalized).toBeDefined();
    expect(finalized?.id).toBe("mr_finalized");
    expect(results).toHaveLength(3); // SELF + FINALIZED-skip + ALL
  });

  // ---------------------------------------------------------------------------
  // Case 3: Empty data → 0-value rows for SELF and ALL
  // ---------------------------------------------------------------------------

  it("3. empty data → 0-value rows created for SELF and ALL scopes", async () => {
    queryRawMock
      .mockResolvedValueOnce([]) // contracts
      .mockResolvedValueOnce([]); // incentives

    findFirstMock.mockResolvedValue(null);

    createMock
      .mockResolvedValueOnce(makeCreatedReport("mr_self", "SELF"))
      .mockResolvedValueOnce(makeCreatedReport("mr_all", "ALL"));

    const results = await aggregateForMonth(tx, "ws_1", "2026-05");

    // SELF + ALL only (no DEALER / JOINT relationships to iterate).
    expect(createMock).toHaveBeenCalledTimes(2);

    // Verify the aggregated payload passed to create has all-zero values.
    const selfCall = createMock.mock.calls[0]![0] as {
      data: { aggregated: { contractCount: number; totalSales: number } };
    };
    expect(selfCall.data.aggregated.contractCount).toBe(0);
    expect(selfCall.data.aggregated.totalSales).toBe(0);

    expect(results).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Case 4: JOINT scope produces per-relationship MonthlyReport
  // ---------------------------------------------------------------------------

  it("4. JOINT scope — produces one MonthlyReport per relationship", async () => {
    queryRawMock
      .mockResolvedValueOnce([
        makeContractRow("c1", 1_200_000, 200_000, "JOINT", "rel_a"),
        makeContractRow("c2", 900_000, 150_000, "JOINT", "rel_b"),
      ])
      .mockResolvedValueOnce([
        makeIncentiveRow("rel_a", 20_000, "JOINT"),
        makeIncentiveRow("rel_b", 15_000, "JOINT"),
      ]);

    findFirstMock.mockResolvedValue(null);

    createMock
      .mockResolvedValueOnce(makeCreatedReport("mr_self", "SELF"))
      .mockResolvedValueOnce(makeCreatedReport("mr_joint_a", "JOINT", "rel_a"))
      .mockResolvedValueOnce(makeCreatedReport("mr_joint_b", "JOINT", "rel_b"))
      .mockResolvedValueOnce(makeCreatedReport("mr_all", "ALL"));

    const results = await aggregateForMonth(tx, "ws_1", "2026-05");

    // SELF + JOINT×2 + ALL = 4 creates.
    expect(createMock).toHaveBeenCalledTimes(4);

    const jointReports = results.filter((r) => r.scope === "JOINT");
    expect(jointReports).toHaveLength(2);

    const relIds = jointReports.map((r) => r.relationshipId).sort();
    expect(relIds).toEqual(["rel_a", "rel_b"]);
  });
});
