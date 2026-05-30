// Unit tests for construction Server Actions (T-05-10 / F-044).
//
// Cases:
//   1. createConstructionAction — normal creation (CONTRACTED contract).
//   2. createConstructionAction — throws InvalidStateTransitionError for CANCELLED contract.
//   3. changeConstructionStatusAction — valid transition REQUEST_PENDING → REQUESTED.
//   4. changeConstructionStatusAction — invalid transition throws InvalidStateTransitionError.
//   5. updateConstructionAction — fee update triggers recalcGrossProfitAction when
//      GrossProfit record exists.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvalidStateTransitionError, NotFoundError } from "../../../../../../lib/errors.js";

// ---------------------------------------------------------------------------
// Mock layer
// ---------------------------------------------------------------------------

const authMock = vi.fn();
const constructionFindUniqueMock = vi.fn();
const constructionCreateMock = vi.fn();
const constructionUpdateMock = vi.fn();
const contractFindUniqueMock = vi.fn();
const grossProfitFindUniqueMock = vi.fn();
const grossProfitUpsertMock = vi.fn();
const contractItemFindManyMock = vi.fn();
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
    },
    construction: {
      findUnique: (...args: unknown[]) => constructionFindUniqueMock(...args),
      create: (...args: unknown[]) => constructionCreateMock(...args),
      update: (...args: unknown[]) => constructionUpdateMock(...args),
    },
    grossProfit: {
      findUnique: (...args: unknown[]) => grossProfitFindUniqueMock(...args),
      upsert: (...args: unknown[]) => grossProfitUpsertMock(...args),
    },
    contractItem: {
      findMany: (...args: unknown[]) => contractItemFindManyMock(...args),
    },
  };
  return {
    ...actual,
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const {
  createConstructionAction,
  changeConstructionStatusAction,
  updateConstructionAction,
} = await import("../actions.js");

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

function makeConstruction(overrides: Record<string, unknown> = {}) {
  return {
    id: "con_1",
    contractId: "contract_1",
    installerId: null,
    status: "REQUEST_PENDING",
    fee: null,
    surveyDate: null,
    plannedDate: null,
    completedDate: null,
    note: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

function makeGrossProfit(overrides: Record<string, unknown> = {}) {
  return {
    id: "gp_1",
    contractId: "contract_1",
    salesPrice: { toString: () => "500000" },
    purchaseTotal: { toString: () => "300000" },
    dealerTotal: { toString: () => "350000" },
    constructionFee: { toString: () => "0" },
    otherCost: { toString: () => "0" },
    discount: { toString: () => "0" },
    projectProfit: { toString: () => "200000" },
    wholesaleProfit: { toString: () => "50000" },
    profitRate: { toString: () => "0.4000" },
    incentiveTargetProfit: { toString: () => "200000" },
    incentiveTargetType: "PROJECT_PROFIT",
    manualAdjustedAt: null,
    manualAdjustmentReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
  contractFindUniqueMock.mockReset();
  constructionFindUniqueMock.mockReset();
  constructionCreateMock.mockReset();
  constructionUpdateMock.mockReset();
  grossProfitFindUniqueMock.mockReset();
  grossProfitUpsertMock.mockReset();
  contractItemFindManyMock.mockReset();
  revalidatePathMock.mockReset();

  contractItemFindManyMock.mockResolvedValue([
    {
      qty: { toString: () => "2" },
      snapshotPurchasePrice: { toString: () => "150000" },
      snapshotDealerPrice: { toString: () => "175000" },
      snapshotListPrice: { toString: () => "200000" },
    },
  ]);
});

// ---------------------------------------------------------------------------
// Case 1: createConstructionAction — normal creation
// ---------------------------------------------------------------------------

describe("createConstructionAction", () => {
  it("1. creates a construction record for an active contract", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    contractFindUniqueMock.mockResolvedValue({ id: "contract_1", status: "CONTRACTED" });
    constructionCreateMock.mockResolvedValue(makeConstruction());

    const result = await createConstructionAction({
      contractId: "contract_1",
      fee: "50000",
    });

    expect(result.contractId).toBe("contract_1");
    expect(result.status).toBe("REQUEST_PENDING");
    expect(constructionCreateMock).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Case 2: CANCELLED contract — throws InvalidStateTransitionError
  // -------------------------------------------------------------------------

  it("2. throws InvalidStateTransitionError for a CANCELLED contract", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    contractFindUniqueMock.mockResolvedValue({ id: "contract_2", status: "CANCELLED" });

    await expect(
      createConstructionAction({ contractId: "contract_2", fee: "0" }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);

    expect(constructionCreateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 3: changeConstructionStatusAction — valid transition
// ---------------------------------------------------------------------------

describe("changeConstructionStatusAction", () => {
  it("3. valid transition REQUEST_PENDING → REQUESTED succeeds", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    constructionFindUniqueMock.mockResolvedValue(
      makeConstruction({ status: "REQUEST_PENDING" }),
    );
    constructionUpdateMock.mockResolvedValue(
      makeConstruction({ status: "REQUESTED" }),
    );

    const result = await changeConstructionStatusAction({
      id: "con_1",
      status: "REQUESTED",
    });

    expect(result.status).toBe("REQUESTED");
    expect(constructionUpdateMock).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Case 4: invalid transition — throws InvalidStateTransitionError
  // -------------------------------------------------------------------------

  it("4. invalid transition REQUEST_PENDING → DONE throws InvalidStateTransitionError", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    constructionFindUniqueMock.mockResolvedValue(
      makeConstruction({ status: "REQUEST_PENDING" }),
    );

    await expect(
      changeConstructionStatusAction({ id: "con_1", status: "DONE" }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);

    expect(constructionUpdateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 5: updateConstructionAction — fee update triggers gross-profit recalc
// ---------------------------------------------------------------------------

describe("updateConstructionAction — fee change triggers recalc", () => {
  it("5. fee update recalculates gross profit when GrossProfit record exists", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    constructionFindUniqueMock.mockResolvedValue(
      makeConstruction({ fee: { toString: () => "0" } }),
    );
    constructionUpdateMock.mockResolvedValue(
      makeConstruction({ fee: { toString: () => "30000" } }),
    );

    grossProfitFindUniqueMock.mockResolvedValue(makeGrossProfit());
    // recalcGrossProfitAction calls contract.findUnique internally — return non-null
    contractFindUniqueMock.mockResolvedValue({ id: "contract_1" });
    // recalcGrossProfitAction also calls contractItem.findMany — return 1 item
    contractItemFindManyMock.mockResolvedValue([
      {
        qty: { toString: () => "2" },
        snapshotPurchasePrice: { toString: () => "150000" },
        snapshotDealerPrice: { toString: () => "175000" },
        snapshotListPrice: { toString: () => "200000" },
      },
    ]);
    // recalcGrossProfitAction will call grossProfit.upsert internally
    grossProfitUpsertMock.mockResolvedValue(makeGrossProfit());

    await updateConstructionAction({
      id: "con_1",
      fee: "30000",
    });

    // The gross profit upsert must have been called (from recalcGrossProfitAction).
    expect(grossProfitUpsertMock).toHaveBeenCalledOnce();
  });

  it("5b. fee update does NOT recalc when no GrossProfit record exists", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    constructionFindUniqueMock.mockResolvedValue(
      makeConstruction({ fee: null }),
    );
    constructionUpdateMock.mockResolvedValue(
      makeConstruction({ fee: { toString: () => "20000" } }),
    );
    grossProfitFindUniqueMock.mockResolvedValue(null);

    await updateConstructionAction({ id: "con_1", fee: "20000" });

    // No gross profit upsert should occur when there's no existing GP record.
    expect(grossProfitUpsertMock).not.toHaveBeenCalled();
  });

  it("5c. construction not found — throws NotFoundError", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    constructionFindUniqueMock.mockResolvedValue(null);

    await expect(
      updateConstructionAction({ id: "non_existent", fee: "10000" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(constructionUpdateMock).not.toHaveBeenCalled();
  });
});
