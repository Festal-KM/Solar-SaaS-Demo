// Unit tests for adjustJointIncentiveAction (T-06-03 / F-047).
//
// Covers:
//   1. JOINT DRAFT → distributions applied → FINALIZED, adjustments created.
//   2. Non-JOINT contract → ValidationError thrown.
//   3. Already-FINALIZED incentive in distributions → ConflictError (409).
//   4. Missing contract → NotFoundError.
//   5. Missing incentive for given relationshipId → NotFoundError.

import { describe, expect, it, vi, beforeEach } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "../../../../../../lib/errors.js";
import { notificationService } from "@/lib/notifications/notification-service";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const contractFindUniqueMock = vi.fn();
const incentiveFindUniqueMock = vi.fn();
const incentiveUpdateMock = vi.fn();
const incentiveAdjustmentCreateMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/notifications/notification-service", () => ({
  notificationService: { fire: vi.fn().mockResolvedValue({ notificationIds: [], skippedCount: 0 }) },
}));

vi.mock("@/lib/notifications/recipient-helpers", () => ({
  resolveDealerAdmins: vi.fn().mockResolvedValue([]),
  resolveWholesalerAdmins: vi.fn().mockResolvedValue([]),
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
    contract: {
      findUnique: (...args: unknown[]) => contractFindUniqueMock(...args),
    },
    incentive: {
      findUnique: (...args: unknown[]) => incentiveFindUniqueMock(...args),
      update: (...args: unknown[]) => incentiveUpdateMock(...args),
    },
    incentiveAdjustment: {
      create: (...args: unknown[]) => incentiveAdjustmentCreateMock(...args),
    },
  };
  return {
    ...actual,
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { adjustJointIncentiveAction } = await import("../actions.js");

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
  contractId: "contract_joint_1",
  distributions: [
    {
      relationshipId: "rel_1",
      amount: "120000",
      reason: "共同開催合意による配分",
    },
  ],
};

const JOINT_CONTRACT = {
  id: "contract_joint_1",
  eventModeAtContract: "JOINT",
  wholesalerId: "tenant_ws_a",
};

const DRAFT_INCENTIVE = {
  id: "inc_1",
  status: "DRAFT",
  amount: { toString: () => "150000.00" },
};

beforeEach(() => {
  authMock.mockReset();
  contractFindUniqueMock.mockReset();
  incentiveFindUniqueMock.mockReset();
  incentiveUpdateMock.mockReset();
  incentiveAdjustmentCreateMock.mockReset();
  revalidatePathMock.mockReset();
  vi.mocked(notificationService.fire).mockReset();
  vi.mocked(notificationService.fire).mockResolvedValue({ notificationIds: [], skippedCount: 0 });

  authMock.mockResolvedValue(WS_SESSION);
  contractFindUniqueMock.mockResolvedValue(JOINT_CONTRACT);
  incentiveFindUniqueMock.mockResolvedValue(DRAFT_INCENTIVE);
  incentiveAdjustmentCreateMock.mockResolvedValue({ id: "adj_1" });
  incentiveUpdateMock.mockResolvedValue({ id: "inc_1" });
});

describe("adjustJointIncentiveAction", () => {
  it("1. JOINT DRAFT → distribution applied, IncentiveAdjustment(JOINT_DISTRIBUTION) created, Incentive FINALIZED, fires INCENTIVE_FINALIZED", async () => {
    // resolveDealerAdmins must return non-empty so fire() is invoked
    const { resolveDealerAdmins } = await import("@/lib/notifications/recipient-helpers");
    vi.mocked(resolveDealerAdmins).mockResolvedValue(["u_dealer_admin"]);

    const result = await adjustJointIncentiveAction(BASE_INPUT);

    expect(result.updatedIncentiveIds).toEqual(["inc_1"]);
    expect(result.adjustmentIds).toEqual(["adj_1"]);

    // Adjustment created with JOINT_DISTRIBUTION kind and correct amounts.
    expect(incentiveAdjustmentCreateMock).toHaveBeenCalledOnce();
    const adjCall = incentiveAdjustmentCreateMock.mock.calls[0]![0] as {
      data: {
        kind: string;
        beforeAmount: string;
        afterAmount: string;
        reason: string;
        incentiveId: string;
      };
    };
    expect(adjCall.data.kind).toBe("JOINT_DISTRIBUTION");
    expect(adjCall.data.beforeAmount).toBe("150000.00");
    expect(adjCall.data.afterAmount).toBe("120000.00");
    expect(adjCall.data.reason).toBe("共同開催合意による配分");
    expect(adjCall.data.incentiveId).toBe("inc_1");

    // Incentive updated to FINALIZED with new amount.
    expect(incentiveUpdateMock).toHaveBeenCalledOnce();
    const incUpdate = incentiveUpdateMock.mock.calls[0]![0] as {
      data: { amount: string; status: string; finalizedAt: Date };
    };
    expect(incUpdate.data.amount).toBe("120000.00");
    expect(incUpdate.data.status).toBe("FINALIZED");
    expect(incUpdate.data.finalizedAt).toBeInstanceOf(Date);

    // Path revalidation triggered.
    expect(revalidatePathMock).toHaveBeenCalledWith(`/contracts/${BASE_INPUT.contractId}/incentive`);

    // Notification fired for INCENTIVE_FINALIZED
    expect(notificationService.fire).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "INCENTIVE_FINALIZED" }),
    );
  });

  it("2. Non-JOINT contract → ValidationError", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...JOINT_CONTRACT,
      eventModeAtContract: "DEALER",
    });

    await expect(adjustJointIncentiveAction(BASE_INPUT)).rejects.toBeInstanceOf(
      ValidationError,
    );

    expect(incentiveFindUniqueMock).not.toHaveBeenCalled();
    expect(incentiveAdjustmentCreateMock).not.toHaveBeenCalled();
  });

  it("3. Already-FINALIZED incentive → ConflictError", async () => {
    incentiveFindUniqueMock.mockResolvedValue({
      id: "inc_1",
      status: "FINALIZED",
      amount: { toString: () => "120000.00" },
    });

    await expect(adjustJointIncentiveAction(BASE_INPUT)).rejects.toBeInstanceOf(
      ConflictError,
    );

    expect(incentiveAdjustmentCreateMock).not.toHaveBeenCalled();
    expect(incentiveUpdateMock).not.toHaveBeenCalled();
  });

  it("4. Missing contract → NotFoundError", async () => {
    contractFindUniqueMock.mockResolvedValue(null);

    await expect(adjustJointIncentiveAction(BASE_INPUT)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    expect(incentiveFindUniqueMock).not.toHaveBeenCalled();
  });

  it("5. Missing incentive for given relationshipId → NotFoundError", async () => {
    incentiveFindUniqueMock.mockResolvedValue(null);

    await expect(adjustJointIncentiveAction(BASE_INPUT)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    expect(incentiveAdjustmentCreateMock).not.toHaveBeenCalled();
  });
});
