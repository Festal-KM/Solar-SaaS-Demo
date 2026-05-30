// Unit tests for dealer contract data loaders (T-05-09 / F-040).
//
// Required cases:
//   1. listDealerContracts — only returns contracts whose ownerRelationshipId
//      is in ctx.relationshipIds (self-relation filter).
//   2. getDealerContractDetail — snapshotPurchasePrice is physically absent
//      from every item in the returned DTO.
//   3. getDealerContractDetail — contract whose ownerRelationshipId is NOT in
//      ctx.relationshipIds returns null (cross-tenant isolation).
//   4. listDealerContracts — status filter is applied correctly.
//   5. getDealerContractDetail — contract not found → returns null.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  toContractItemDealerDto,
  toContractItemWholesalerDto,
  type ContractItemForWholesalerDto,
} from "@solar/contracts";

// ---------------------------------------------------------------------------
// Mock layer
// ---------------------------------------------------------------------------

const authMock = vi.fn();
const contractFindUniqueMock = vi.fn();
const contractFindManyMock = vi.fn();
const contractCountMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

import type * as DbModule from "@solar/db";

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    contract: {
      findUnique: (...args: unknown[]) => contractFindUniqueMock(...args),
      findMany: (...args: unknown[]) => contractFindManyMock(...args),
      count: (...args: unknown[]) => contractCountMock(...args),
    },
  };
  return {
    ...actual,
    // rawPrisma is used by getTenantContext for dealer relationship resolution.
    rawPrisma: {
      relationship: {
        findMany: () =>
          Promise.resolve([{ id: REL_ID_OWN }]),
      },
    },
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { listDealerContracts, getDealerContractDetail } = await import("../data.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REL_ID_OWN = "rel_dealer_a";
const REL_ID_OTHER = "rel_dealer_b";

const DEALER_SESSION = {
  user: {
    id: "u_dealer_admin",
    tenantId: "tenant_dealer",
    tenantType: "DEALER",
    wholesalerId: "tenant_ws_a",
    dealerId: "tenant_dealer",
    roles: ["DEALER_ADMIN"],
    isSaasAdmin: false,
  },
};

const CONTRACT_DATE = new Date("2026-06-01T00:00:00.000Z");
const CANCEL_DEADLINE = new Date("2026-06-09T00:00:00.000Z");

function makeContractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "contract_1",
    customerId: "cust_1",
    contractDate: CONTRACT_DATE,
    contractAmount: { toString: () => "1500000" },
    status: "CONTRACTED",
    cancelDeadline: CANCEL_DEADLINE,
    ownerRelationshipId: REL_ID_OWN,
    customer: { name: "山田 太郎" },
    items: [],
    ...overrides,
  };
}

function makeItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ci_1",
    contractId: "contract_1",
    productId: "prod_1",
    productName: "テストパネル",
    maker: "テストメーカー",
    modelNo: "TP-100",
    qty: { toString: () => "2" },
    unit: "枚",
    snapshotPurchasePrice: { toString: () => "80000" },
    snapshotDealerPrice: { toString: () => "90000" },
    snapshotListPrice: { toString: () => "100000" },
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
  contractFindUniqueMock.mockReset();
  contractFindManyMock.mockReset();
  contractCountMock.mockReset();
});

// ---------------------------------------------------------------------------
// Test: self-relation filter in listDealerContracts
// ---------------------------------------------------------------------------

describe("listDealerContracts", () => {
  it("1. only returns contracts in ctx.relationshipIds (self-relation filter)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);

    const ownContract = makeContractRow({ id: "c_own", ownerRelationshipId: REL_ID_OWN });
    contractFindManyMock.mockResolvedValue([ownContract]);
    contractCountMock.mockResolvedValue(1);

    const result = await listDealerContracts({});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe("c_own");

    // Confirm the where clause uses ctx.relationshipIds
    const call = contractFindManyMock.mock.calls[0]![0] as {
      where: { ownerRelationshipId: { in: string[] } };
    };
    expect(call.where.ownerRelationshipId.in).toEqual([REL_ID_OWN]);
  });

  it("4. status filter is forwarded to the where clause", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    contractFindManyMock.mockResolvedValue([]);
    contractCountMock.mockResolvedValue(0);

    await listDealerContracts({ status: "CANCELLED" });

    const call = contractFindManyMock.mock.calls[0]![0] as {
      where: { status: string };
    };
    expect(call.where.status).toBe("CANCELLED");
  });
});

// ---------------------------------------------------------------------------
// Test: snapshotPurchasePrice physically excluded in getDealerContractDetail
// ---------------------------------------------------------------------------

describe("getDealerContractDetail", () => {
  it("2. snapshotPurchasePrice is physically absent from every item in the DTO", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    contractFindUniqueMock.mockResolvedValue(
      makeContractRow({ items: [makeItemRow()] }),
    );

    const detail = await getDealerContractDetail("contract_1");

    expect(detail).not.toBeNull();
    expect(detail!.items).toHaveLength(1);

    const item = detail!.items[0]!;
    // Must NOT contain snapshotPurchasePrice at all (not even undefined or null)
    expect(Object.keys(item)).not.toContain("snapshotPurchasePrice");
    // Dealer price and list price must still be present
    expect(item.snapshotDealerPrice).toBe("90000");
    expect(item.snapshotListPrice).toBe("100000");
  });

  it("3. contract owned by other relationship → returns null (cross-tenant isolation)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    contractFindUniqueMock.mockResolvedValue(
      makeContractRow({ ownerRelationshipId: REL_ID_OTHER }),
    );

    const detail = await getDealerContractDetail("contract_1");

    expect(detail).toBeNull();
  });

  it("5. contract not found → returns null", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    contractFindUniqueMock.mockResolvedValue(null);

    const detail = await getDealerContractDetail("no_such_contract");

    expect(detail).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test: toContractItemDealerDto DTO helper (unit, no mocks needed)
// ---------------------------------------------------------------------------

describe("toContractItemDealerDto (DTO physical exclusion)", () => {
  it("snapshotPurchasePrice is absent in Object.keys() of dealer DTO", () => {
    const wsDto: ContractItemForWholesalerDto = {
      id: "ci_1",
      contractId: "contract_1",
      productId: "prod_1",
      productName: "テストパネル",
      maker: "テストメーカー",
      modelNo: "TP-100",
      qty: "2",
      unit: "枚",
      snapshotPurchasePrice: "80000",
      snapshotDealerPrice: "90000",
      snapshotListPrice: "100000",
      subtotal: "200000.00",
      createdAt: new Date().toISOString(),
    };

    const wholesalerResult = toContractItemWholesalerDto(wsDto);
    expect(Object.keys(wholesalerResult)).toContain("snapshotPurchasePrice");

    const dealerResult = toContractItemDealerDto(wsDto);
    expect(Object.keys(dealerResult)).not.toContain("snapshotPurchasePrice");
    expect(dealerResult.snapshotDealerPrice).toBe("90000");
    expect(dealerResult.snapshotListPrice).toBe("100000");
    expect(dealerResult.subtotal).toBe("200000.00");
  });
});
