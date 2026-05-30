// Unit tests for cancelContractAction (T-06-04 / F-043).
//
// Covers:
//   1. Within-deadline cancel → Incentive.status=CANCELLED, no adjustments.
//   2. After-deadline cancel → IncentiveAdjustment(NEGATIVE_AFTER_DEADLINE) created,
//      Incentive.status=NEGATIVE_ADJUSTED, appliedMonth = next month.
//   3. Non-ACTIVE contract (DONE / CANCELLED) → InvalidStateTransitionError.
//   4. No Incentive rows → Contract cancelled only, no incentive operations.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvalidStateTransitionError, NotFoundError } from "../../../../../../lib/errors.js";
import { notificationService } from "@/lib/notifications/notification-service";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const contractFindUniqueMock = vi.fn();
const contractUpdateMock = vi.fn();
const incentiveFindManyMock = vi.fn();
const incentiveUpdateMock = vi.fn();
const incentiveAdjustmentCreateMock = vi.fn();
const contractCancellationCreateMock = vi.fn();
const auditLogCreateMock = vi.fn();
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
      update: (...args: unknown[]) => contractUpdateMock(...args),
    },
    incentive: {
      findMany: (...args: unknown[]) => incentiveFindManyMock(...args),
      update: (...args: unknown[]) => incentiveUpdateMock(...args),
    },
    incentiveAdjustment: {
      create: (...args: unknown[]) => incentiveAdjustmentCreateMock(...args),
    },
    contractCancellation: {
      create: (...args: unknown[]) => contractCancellationCreateMock(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreateMock(...args),
    },
  };
  return {
    ...actual,
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { cancelContractAction } = await import("../actions.js");

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
  contractId: "contract_1",
  reason: "お客様都合",
};

beforeEach(async () => {
  vi.useFakeTimers();

  authMock.mockReset();
  contractFindUniqueMock.mockReset();
  contractUpdateMock.mockReset();
  incentiveFindManyMock.mockReset();
  incentiveUpdateMock.mockReset();
  incentiveAdjustmentCreateMock.mockReset();
  contractCancellationCreateMock.mockReset();
  auditLogCreateMock.mockReset();
  auditLogCreateMock.mockResolvedValue({ id: BigInt(1) });
  revalidatePathMock.mockReset();
  vi.mocked(notificationService.fire).mockReset();
  vi.mocked(notificationService.fire).mockResolvedValue({ notificationIds: [], skippedCount: 0 });

  const { resolveDealerAdmins } = await import("@/lib/notifications/recipient-helpers");
  vi.mocked(resolveDealerAdmins).mockReset();
  vi.mocked(resolveDealerAdmins).mockResolvedValue([]);

  // Default mocks
  authMock.mockResolvedValue(WS_SESSION);
  contractUpdateMock.mockResolvedValue({ id: "contract_1" });
  incentiveUpdateMock.mockResolvedValue({ id: "inc_1" });
  incentiveAdjustmentCreateMock.mockResolvedValue({ id: "adj_1" });
  contractCancellationCreateMock.mockResolvedValue({ id: "cancellation_1" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cancelContractAction", () => {
  it("1. within-deadline cancel → Incentive.status=CANCELLED, no adjustments, fires INCENTIVE_PENDING", async () => {
    // now = 2026-06-05, cancelDeadline = 2026-06-09 (within deadline)
    vi.setSystemTime(new Date("2026-06-05T12:00:00.000Z"));

    contractFindUniqueMock.mockResolvedValue({
      id: "contract_1",
      status: "CONTRACTED",
      cancelDeadline: new Date("2026-06-09T23:59:59.000Z"),
      wholesalerId: "tenant_ws_a",
      ownerRelationshipId: "rel_a",
    });

    incentiveFindManyMock.mockResolvedValue([
      { id: "inc_1", amount: { toString: () => "150000.00" }, settledMonth: "2026-06" },
    ]);

    // resolveDealerAdmins returns a non-empty list so fire() is invoked
    const { resolveDealerAdmins } = await import("@/lib/notifications/recipient-helpers");
    vi.mocked(resolveDealerAdmins).mockResolvedValue(["u_dealer_admin"]);

    const result = await cancelContractAction(BASE_INPUT);

    expect(result.isWithinDeadline).toBe(true);
    expect(result.cancelledIncentiveIds).toEqual(["inc_1"]);
    expect(result.negativeAdjustmentIds).toEqual([]);

    // Incentive updated to CANCELLED
    expect(incentiveUpdateMock).toHaveBeenCalledOnce();
    const incUpdate = incentiveUpdateMock.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string; cancelledAt: Date };
    };
    expect(incUpdate.where.id).toBe("inc_1");
    expect(incUpdate.data.status).toBe("CANCELLED");
    expect(incUpdate.data.cancelledAt).toBeInstanceOf(Date);

    // No adjustments created
    expect(incentiveAdjustmentCreateMock).not.toHaveBeenCalled();

    // ContractCancellation created with isWithinDeadline=true
    expect(contractCancellationCreateMock).toHaveBeenCalledOnce();
    const cancellationCall = contractCancellationCreateMock.mock.calls[0]![0] as {
      data: { isWithinDeadline: boolean; negativeAdjustmentIds: string[] };
    };
    expect(cancellationCall.data.isWithinDeadline).toBe(true);
    expect(cancellationCall.data.negativeAdjustmentIds).toEqual([]);

    // Notification fired for INCENTIVE_PENDING
    expect(notificationService.fire).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "INCENTIVE_PENDING" }),
    );
  });

  it("2. after-deadline cancel → IncentiveAdjustment(NEGATIVE_AFTER_DEADLINE), appliedMonth=翌月", async () => {
    // now = 2026-06-20, cancelDeadline = 2026-06-09 (past deadline)
    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));

    contractFindUniqueMock.mockResolvedValue({
      id: "contract_1",
      status: "CONTRACTED",
      cancelDeadline: new Date("2026-06-09T23:59:59.000Z"),
      wholesalerId: "tenant_ws_a",
    });

    incentiveFindManyMock.mockResolvedValue([
      { id: "inc_1", amount: { toString: () => "200000.00" }, settledMonth: "2026-06" },
    ]);
    incentiveAdjustmentCreateMock.mockResolvedValue({ id: "adj_1" });

    const result = await cancelContractAction(BASE_INPUT);

    expect(result.isWithinDeadline).toBe(false);
    expect(result.cancelledIncentiveIds).toEqual([]);
    expect(result.negativeAdjustmentIds).toEqual(["adj_1"]);

    // Adjustment created with NEGATIVE_AFTER_DEADLINE, appliedMonth = "2026-07"
    expect(incentiveAdjustmentCreateMock).toHaveBeenCalledOnce();
    const adjCall = incentiveAdjustmentCreateMock.mock.calls[0]![0] as {
      data: {
        incentiveId: string;
        kind: string;
        beforeAmount: string;
        afterAmount: string;
        appliedMonth: string;
        reason: string;
      };
    };
    expect(adjCall.data.kind).toBe("NEGATIVE_AFTER_DEADLINE");
    expect(adjCall.data.appliedMonth).toBe("2026-07");
    expect(adjCall.data.beforeAmount).toBe("200000.00");
    expect(adjCall.data.afterAmount).toBe("0.00");

    // Incentive updated to NEGATIVE_ADJUSTED
    expect(incentiveUpdateMock).toHaveBeenCalledOnce();
    const incUpdate = incentiveUpdateMock.mock.calls[0]![0] as {
      data: { status: string };
    };
    expect(incUpdate.data.status).toBe("NEGATIVE_ADJUSTED");

    // ContractCancellation with isWithinDeadline=false
    const cancellationCall = contractCancellationCreateMock.mock.calls[0]![0] as {
      data: { isWithinDeadline: boolean; negativeAdjustmentIds: string[] };
    };
    expect(cancellationCall.data.isWithinDeadline).toBe(false);
    expect(cancellationCall.data.negativeAdjustmentIds).toEqual(["adj_1"]);
  });

  it("3. DONE contract → InvalidStateTransitionError", async () => {
    vi.setSystemTime(new Date("2026-06-05T12:00:00.000Z"));

    contractFindUniqueMock.mockResolvedValue({
      id: "contract_1",
      status: "DONE",
      cancelDeadline: new Date("2026-06-09T23:59:59.000Z"),
      wholesalerId: "tenant_ws_a",
    });

    await expect(cancelContractAction(BASE_INPUT)).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );

    expect(contractUpdateMock).not.toHaveBeenCalled();
    expect(incentiveFindManyMock).not.toHaveBeenCalled();
    expect(contractCancellationCreateMock).not.toHaveBeenCalled();
  });

  it("3b. already CANCELLED contract → InvalidStateTransitionError", async () => {
    vi.setSystemTime(new Date("2026-06-05T12:00:00.000Z"));

    contractFindUniqueMock.mockResolvedValue({
      id: "contract_1",
      status: "CANCELLED",
      cancelDeadline: new Date("2026-06-09T23:59:59.000Z"),
      wholesalerId: "tenant_ws_a",
    });

    await expect(cancelContractAction(BASE_INPUT)).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );

    expect(contractUpdateMock).not.toHaveBeenCalled();
  });

  it("4. no Incentive rows → contract cancelled, no incentive operations", async () => {
    vi.setSystemTime(new Date("2026-06-05T12:00:00.000Z"));

    contractFindUniqueMock.mockResolvedValue({
      id: "contract_1",
      status: "CONTRACTED",
      cancelDeadline: new Date("2026-06-09T23:59:59.000Z"),
      wholesalerId: "tenant_ws_a",
    });

    incentiveFindManyMock.mockResolvedValue([]);

    const result = await cancelContractAction(BASE_INPUT);

    expect(result.isWithinDeadline).toBe(true);
    expect(result.cancelledIncentiveIds).toEqual([]);
    expect(result.negativeAdjustmentIds).toEqual([]);

    // Contract still cancelled
    expect(contractUpdateMock).toHaveBeenCalledOnce();

    // No incentive operations
    expect(incentiveUpdateMock).not.toHaveBeenCalled();
    expect(incentiveAdjustmentCreateMock).not.toHaveBeenCalled();

    // ContractCancellation still created
    expect(contractCancellationCreateMock).toHaveBeenCalledOnce();
  });
});
