// Unit tests for replaceContractItemsAction (T-05-07 / F-041).
//
// Four required cases:
//   1. Normal snapshot — contractDate-point prices are copied into ContractItem rows.
//   2. Product master revised after snapshot — existing snapshot remains unchanged
//      (action re-snapshotting old contract would use old date, not new prices).
//   3. Dealer DTO — snapshotPurchasePrice is physically absent from Object.keys().
//   4. CANCELLED contract — replaceContractItemsAction throws InvalidStateTransitionError.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  toContractItemDealerDto,
  toContractItemWholesalerDto,
  type ContractItemForWholesalerDto,
} from "@solar/contracts";

import { InvalidStateTransitionError, NotFoundError } from "../../../../../../lib/errors.js";

// ---------------------------------------------------------------------------
// Mock layer
// ---------------------------------------------------------------------------

const authMock = vi.fn();
const contractFindUniqueMock = vi.fn();
const productFindManyMock = vi.fn();
const contractItemDeleteManyMock = vi.fn();
const contractItemCreateManyMock = vi.fn();
const contractUpdateMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

import type * as DbModule from "@solar/db";

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    contract: {
      findUnique: (...args: unknown[]) => contractFindUniqueMock(...args),
      update: (...args: unknown[]) => contractUpdateMock(...args),
    },
    product: {
      findMany: (...args: unknown[]) => productFindManyMock(...args),
    },
    contractItem: {
      deleteMany: (...args: unknown[]) => contractItemDeleteManyMock(...args),
      createMany: (...args: unknown[]) => contractItemCreateManyMock(...args),
    },
  };
  return {
    ...actual,
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { replaceContractItemsAction } = await import("../actions.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WS_SESSION = {
  user: {
    id: "u_ws_admin",
    tenantId: "tenant_ws",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws",
    dealerId: null,
    roles: ["WHOLESALER_ADMIN"],
    isSaasAdmin: false,
  },
};

const CONTRACT_DATE = new Date("2026-06-01T00:00:00.000Z");

const ACTIVE_CONTRACT = {
  id: "contract_1",
  status: "CONTRACTED",
  contractDate: CONTRACT_DATE,
  wholesalerId: "tenant_ws",
};

const CANCELLED_CONTRACT = {
  id: "contract_2",
  status: "CANCELLED",
  contractDate: CONTRACT_DATE,
  wholesalerId: "tenant_ws",
};

// Product effective June 2026 — prices at snapshot time
function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod_1",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    isActive: true,
    name: "テストパネル",
    maker: "テストメーカー",
    modelNo: "TP-100",
    unit: "枚",
    purchasePrice: { toString: () => "80000" },
    dealerPrice: { toString: () => "90000" },
    listPrice: { toString: () => "100000" },
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
  contractFindUniqueMock.mockReset();
  productFindManyMock.mockReset();
  contractItemDeleteManyMock.mockReset();
  contractItemCreateManyMock.mockReset();
  contractUpdateMock.mockReset();
  revalidatePathMock.mockReset();

  contractItemDeleteManyMock.mockResolvedValue({ count: 0 });
  contractItemCreateManyMock.mockResolvedValue({ count: 1 });
  contractUpdateMock.mockResolvedValue({ id: "contract_1" });
});

// ---------------------------------------------------------------------------
// Case 1: Normal snapshot — contractDate-point prices are captured
// ---------------------------------------------------------------------------

describe("replaceContractItemsAction", () => {
  it("1. normal snapshot — prices effective at contractDate are copied into ContractItem", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    contractFindUniqueMock.mockResolvedValue(ACTIVE_CONTRACT);
    productFindManyMock.mockResolvedValue([makeProduct()]);

    const result = await replaceContractItemsAction({
      contractId: "contract_1",
      items: [{ productId: "prod_1", qty: 2 }],
    });

    expect(result.contractId).toBe("contract_1");
    expect(result.itemCount).toBe(1);

    // createMany was called with the snapshotted prices
    const createCall = contractItemCreateManyMock.mock.calls[0]![0] as {
      data: Array<{
        snapshotPurchasePrice: string;
        snapshotDealerPrice: string;
        snapshotListPrice: string;
        qty: string;
        productName: string;
      }>;
    };
    const row = createCall.data[0]!;
    expect(row.snapshotPurchasePrice).toBe("80000");
    expect(row.snapshotDealerPrice).toBe("90000");
    expect(row.snapshotListPrice).toBe("100000");
    expect(row.qty).toBe("2");
    expect(row.productName).toBe("テストパネル");

    // totalAmount = 2 × 100000 = 200000
    const updateCall = contractUpdateMock.mock.calls[0]![0] as {
      data: { contractAmount: string };
    };
    expect(updateCall.data.contractAmount).toBe("200000.00");
  });

  // -------------------------------------------------------------------------
  // Case 2: Product master revised after snapshot — snapshot remains unchanged
  // -------------------------------------------------------------------------

  it("2. product master revision after snapshot — snapshot is based on contractDate, not current prices", async () => {
    // The test simulates two separate calls:
    // - First call (contractDate = 2026-06-01) uses OLD prices (listPrice=100000)
    // - Product master is revised to listPrice=120000 effective 2026-07-01
    // - A second call with the same contractDate still picks 100000

    authMock.mockResolvedValue(WS_SESSION);
    contractFindUniqueMock.mockResolvedValue(ACTIVE_CONTRACT);

    // Products include both the old row AND the new row (post-revision DB state)
    const oldRow = makeProduct({
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-07-01T00:00:00.000Z"), // ended Jul 2026
      purchasePrice: { toString: () => "80000" },
      listPrice: { toString: () => "100000" },
    });
    const newRow = makeProduct({
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
      effectiveTo: null, // ongoing
      purchasePrice: { toString: () => "88000" },
      listPrice: { toString: () => "120000" },
    });

    productFindManyMock.mockResolvedValue([oldRow, newRow]);

    await replaceContractItemsAction({
      contractId: "contract_1",
      items: [{ productId: "prod_1", qty: 1 }],
    });

    // snapshotItems must have chosen oldRow (effective at 2026-06-01, before Jul)
    const createCall = contractItemCreateManyMock.mock.calls[0]![0] as {
      data: Array<{ snapshotListPrice: string; snapshotPurchasePrice: string }>;
    };
    expect(createCall.data[0]!.snapshotListPrice).toBe("100000");
    expect(createCall.data[0]!.snapshotPurchasePrice).toBe("80000");
  });

  // -------------------------------------------------------------------------
  // Case 3: Dealer DTO — snapshotPurchasePrice absent from Object.keys()
  // -------------------------------------------------------------------------

  it("3. dealer DTO — snapshotPurchasePrice is NOT in Object.keys()", () => {
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

    // Wholesaler DTO includes snapshotPurchasePrice
    const wsResult = toContractItemWholesalerDto(wsDto);
    expect(Object.keys(wsResult)).toContain("snapshotPurchasePrice");

    // Dealer DTO physically excludes snapshotPurchasePrice
    const dealerResult = toContractItemDealerDto(wsDto);
    expect(Object.keys(dealerResult)).not.toContain("snapshotPurchasePrice");

    // Ensure other fields are still present
    expect(dealerResult.snapshotDealerPrice).toBe("90000");
    expect(dealerResult.snapshotListPrice).toBe("100000");
    expect(dealerResult.subtotal).toBe("200000.00");
  });

  // -------------------------------------------------------------------------
  // Case 4: CANCELLED contract — throws InvalidStateTransitionError
  // -------------------------------------------------------------------------

  it("4. CANCELLED contract — throws InvalidStateTransitionError, no DB writes", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    contractFindUniqueMock.mockResolvedValue(CANCELLED_CONTRACT);

    await expect(
      replaceContractItemsAction({
        contractId: "contract_2",
        items: [{ productId: "prod_1", qty: 1 }],
      }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);

    expect(contractItemDeleteManyMock).not.toHaveBeenCalled();
    expect(contractItemCreateManyMock).not.toHaveBeenCalled();
    expect(contractUpdateMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Case 5: Contract not found → NotFoundError
  // -------------------------------------------------------------------------

  it("5. contract not found — throws NotFoundError", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    contractFindUniqueMock.mockResolvedValue(null);

    await expect(
      replaceContractItemsAction({
        contractId: "no_such_contract",
        items: [{ productId: "prod_1", qty: 1 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(contractItemDeleteManyMock).not.toHaveBeenCalled();
  });
});
