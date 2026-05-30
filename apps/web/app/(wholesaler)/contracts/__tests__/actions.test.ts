// Unit tests for createContractAction (T-05-06 / F-040 / F-041).
//
// Covers:
//   1. Normal creation — Deal LIKELY_CONTRACT → Contract created, Deal CONTRACTED,
//      GrossProfit created. cancelDeadline = contractDate + 8 days (default).
//      Asserts notificationService.fire called with type=CONTRACT_CONTRACTED.
//   2. Deal not in LIKELY_CONTRACT → InvalidStateTransitionError (other statuses).
//   3. cancelDeadline computation — contractDate + settings.cancelDeadlineDays.
//   4. incentiveRateSnapshot captured from effective rate at contractDate.
//   5. No effective incentive rate → snapshot nulls, still succeeds (F-046).
//   6. Deal not found → NotFoundError.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvalidStateTransitionError, NotFoundError } from "../../../../lib/errors.js";
import { notificationService } from "@/lib/notifications/notification-service";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const dealFindUniqueMock = vi.fn();
const dealUpdateMock = vi.fn();
const wholesalerSettingsFindUniqueMock = vi.fn();
const incentiveRateFindManyMock = vi.fn();
const contractCreateMock = vi.fn();
const contractFindUniqueMock = vi.fn();
const grossProfitCreateMock = vi.fn();
const grossProfitFindUniqueMock = vi.fn();
const incentiveUpsertMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/notifications/notification-service", () => ({
  notificationService: { fire: vi.fn().mockResolvedValue({ notificationIds: [], skippedCount: 0 }) },
}));

vi.mock("@/lib/notifications/recipient-helpers", () => ({
  resolveDealerAdmins: vi.fn().mockResolvedValue([]),
  resolveWholesalerAdmins: vi.fn().mockResolvedValue(["u_ws_admin"]),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    deal: {
      findUnique: (...args: unknown[]) => dealFindUniqueMock(...args),
      update: (...args: unknown[]) => dealUpdateMock(...args),
    },
    wholesalerSettings: {
      findUnique: (...args: unknown[]) => wholesalerSettingsFindUniqueMock(...args),
    },
    incentiveRate: {
      findMany: (...args: unknown[]) => incentiveRateFindManyMock(...args),
    },
    contract: {
      create: (...args: unknown[]) => contractCreateMock(...args),
      findUnique: (...args: unknown[]) => contractFindUniqueMock(...args),
    },
    grossProfit: {
      create: (...args: unknown[]) => grossProfitCreateMock(...args),
      findUnique: (...args: unknown[]) => grossProfitFindUniqueMock(...args),
    },
    incentive: {
      upsert: (...args: unknown[]) => incentiveUpsertMock(...args),
    },
  };
  return {
    ...actual,
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { createContractAction } = await import("../actions.js");

const WS_SESSION = {
  user: {
    id: "u_ws_admin",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_ADMIN"],
    isSaasAdmin: false,
  },
};

const BASE_INPUT = {
  dealId: "deal_1",
  contractDate: "2026-06-01T00:00:00.000Z",
  totalAmount: "1500000",
  isSelfHosted: false,
};

const LIKELY_CONTRACT_DEAL = {
  id: "deal_1",
  status: "LIKELY_CONTRACT",
  ownerRelationshipId: "rel_a_x",
  customerId: "cust_1",
};

beforeEach(() => {
  authMock.mockReset();
  dealFindUniqueMock.mockReset();
  dealUpdateMock.mockReset();
  wholesalerSettingsFindUniqueMock.mockReset();
  incentiveRateFindManyMock.mockReset();
  contractCreateMock.mockReset();
  contractFindUniqueMock.mockReset();
  grossProfitCreateMock.mockReset();
  grossProfitFindUniqueMock.mockReset();
  incentiveUpsertMock.mockReset();
  revalidatePathMock.mockReset();
  vi.mocked(notificationService.fire).mockReset();
  vi.mocked(notificationService.fire).mockResolvedValue({ notificationIds: [], skippedCount: 0 });

  contractCreateMock.mockResolvedValue({ id: "contract_1" });
  grossProfitCreateMock.mockResolvedValue({ id: "gp_1" });

  // finalizeForContract defaults: self-hosted with no relationship → returns [] immediately.
  // Overrides per test can provide a relationship to exercise the incentive path.
  contractFindUniqueMock.mockResolvedValue({
    id: "contract_1",
    isSelfHosted: false,
    status: "CONTRACTED",
    ownerRelationshipId: null,
    incentiveRateSnapshot: null,
    eventModeAtContract: null,
    contractDate: new Date("2026-06-01T00:00:00.000Z"),
  });
  grossProfitFindUniqueMock.mockResolvedValue({ incentiveTargetProfit: 0 });
  incentiveUpsertMock.mockResolvedValue({
    id: "inc_1",
    contractId: "contract_1",
    relationshipId: "rel_a_x",
    amount: "0.00",
    status: "FINALIZED",
    settledMonth: "2026-06",
  });
  dealUpdateMock.mockResolvedValue({ id: "deal_1" });
});

describe("createContractAction", () => {
  it("1. normal creation — LIKELY_CONTRACT deal → contract + deal update + gross profit", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindUniqueMock.mockResolvedValue(LIKELY_CONTRACT_DEAL);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ cancelDeadlineDays: 8 });
    incentiveRateFindManyMock.mockResolvedValue([
      {
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: null,
        rate: { toString: () => "15.00" },
        targetType: "PROJECT_PROFIT",
      },
    ]);

    const result = await createContractAction(BASE_INPUT);

    expect(result).toEqual({ id: "contract_1" });

    // Contract created with wholesalerId from ctx (never input)
    const contractCall = contractCreateMock.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(contractCall.data.wholesalerId).toBe("tenant_ws_a");
    expect(contractCall.data.dealId).toBe("deal_1");
    expect(contractCall.data.status).toBe("CONTRACTED");
    expect(contractCall.data.contractAmount).toBe("1500000");

    // Deal advanced to CONTRACTED
    const dealCall = dealUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string };
    };
    expect(dealCall.where.id).toBe("deal_1");
    expect(dealCall.data.status).toBe("CONTRACTED");

    // GrossProfit created
    expect(grossProfitCreateMock).toHaveBeenCalledOnce();

    // Notification fired for CONTRACT_CONTRACTED
    expect(notificationService.fire).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "CONTRACT_CONTRACTED" }),
    );

    // Paths revalidated
    expect(revalidatePathMock).toHaveBeenCalledWith("/contracts");
    expect(revalidatePathMock).toHaveBeenCalledWith("/deals/deal_1");
  });

  it("2. deal not in LIKELY_CONTRACT → InvalidStateTransitionError", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindUniqueMock.mockResolvedValue({
      ...LIKELY_CONTRACT_DEAL,
      status: "PROPOSING",
    });

    await expect(createContractAction(BASE_INPUT)).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );

    expect(contractCreateMock).not.toHaveBeenCalled();
    expect(dealUpdateMock).not.toHaveBeenCalled();
  });

  it("3. cancelDeadline = contractDate + cancelDeadlineDays (default 8)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindUniqueMock.mockResolvedValue(LIKELY_CONTRACT_DEAL);
    wholesalerSettingsFindUniqueMock.mockResolvedValue(null); // no settings → default 8
    incentiveRateFindManyMock.mockResolvedValue([]);

    await createContractAction(BASE_INPUT);

    const contractCall = contractCreateMock.mock.calls[0]![0] as {
      data: { contractDate: Date; cancelDeadline: Date };
    };
    const contractDate = contractCall.data.contractDate;
    const cancelDeadline = contractCall.data.cancelDeadline;

    const diffMs = cancelDeadline.getTime() - contractDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(8);
  });

  it("4. incentiveRateSnapshot captured from effective rate at contractDate", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindUniqueMock.mockResolvedValue(LIKELY_CONTRACT_DEAL);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ cancelDeadlineDays: 14 });
    incentiveRateFindManyMock.mockResolvedValue([
      {
        effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
        effectiveTo: null,
        rate: { toString: () => "20.00" },
        targetType: "WHOLESALE_PROFIT",
      },
    ]);

    await createContractAction(BASE_INPUT);

    const contractCall = contractCreateMock.mock.calls[0]![0] as {
      data: { incentiveRateSnapshot: string; incentiveTargetTypeSnapshot: string };
    };
    expect(contractCall.data.incentiveRateSnapshot).toBe("20.00");
    expect(contractCall.data.incentiveTargetTypeSnapshot).toBe("WHOLESALE_PROFIT");
  });

  it("5. no effective incentive rate → snapshot nulls, creation still succeeds", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindUniqueMock.mockResolvedValue(LIKELY_CONTRACT_DEAL);
    wholesalerSettingsFindUniqueMock.mockResolvedValue({ cancelDeadlineDays: 8 });
    // Rate exists but effectiveTo is in the past → no effective rate
    incentiveRateFindManyMock.mockResolvedValue([
      {
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2020-12-31T00:00:00.000Z"),
        rate: { toString: () => "10.00" },
        targetType: "PROJECT_PROFIT",
      },
    ]);

    const result = await createContractAction(BASE_INPUT);

    expect(result).toEqual({ id: "contract_1" });

    const contractCall = contractCreateMock.mock.calls[0]![0] as {
      data: { incentiveRateSnapshot: string | undefined };
    };
    // null → omitted (undefined) in Prisma call
    expect(contractCall.data.incentiveRateSnapshot).toBeUndefined();
  });

  it("6. deal not found → NotFoundError", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    dealFindUniqueMock.mockResolvedValue(null);

    await expect(createContractAction(BASE_INPUT)).rejects.toBeInstanceOf(NotFoundError);

    expect(contractCreateMock).not.toHaveBeenCalled();
  });
});
