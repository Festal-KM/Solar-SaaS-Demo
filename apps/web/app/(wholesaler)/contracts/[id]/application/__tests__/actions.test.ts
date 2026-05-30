// Unit tests for application Server Actions (T-05-11 / F-045).
//
// Cases:
//   1. createApplicationAction — normal creation (CONTRACTED contract).
//   2. createApplicationAction — throws InvalidStateTransitionError for CANCELLED contract.
//   3. changeApplicationStatusAction — valid transition DRAFT → SUBMITTED.
//   4. changeApplicationStatusAction — invalid transition DRAFT → APPROVED throws InvalidStateTransitionError.
//   5. changeApplicationStatusAction — APPROVED without confirmedAmount throws ZodError.
//   6. changeApplicationStatusAction — APPROVED with confirmedAmount succeeds.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvalidStateTransitionError, NotFoundError } from "../../../../../../lib/errors.js";

// ---------------------------------------------------------------------------
// Mock layer
// ---------------------------------------------------------------------------

const authMock = vi.fn();
const applicationFindUniqueMock = vi.fn();
const applicationCreateMock = vi.fn();
const applicationUpdateMock = vi.fn();
const contractFindUniqueMock = vi.fn();
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
    application: {
      findUnique: (...args: unknown[]) => applicationFindUniqueMock(...args),
      create: (...args: unknown[]) => applicationCreateMock(...args),
      update: (...args: unknown[]) => applicationUpdateMock(...args),
    },
  };
  return {
    ...actual,
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const {
  createApplicationAction,
  updateApplicationAction,
  changeApplicationStatusAction,
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

function makeApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: "app_1",
    contractId: "contract_1",
    type: "省エネ補助金",
    agency: null,
    plannedDate: null,
    submittedDate: null,
    approvedDate: null,
    status: "DRAFT",
    expectedAmount: null,
    grantedAmount: null,
    note: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  authMock.mockReset();
  contractFindUniqueMock.mockReset();
  applicationFindUniqueMock.mockReset();
  applicationCreateMock.mockReset();
  applicationUpdateMock.mockReset();
  revalidatePathMock.mockReset();
});

// ---------------------------------------------------------------------------
// Case 1: createApplicationAction — normal creation
// ---------------------------------------------------------------------------

describe("createApplicationAction", () => {
  it("1. creates an application record for an active contract", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    contractFindUniqueMock.mockResolvedValue({ id: "contract_1", status: "CONTRACTED" });
    applicationCreateMock.mockResolvedValue(makeApplication());

    const result = await createApplicationAction({
      contractId: "contract_1",
      type: "省エネ補助金",
    });

    expect(result.contractId).toBe("contract_1");
    expect(result.status).toBe("DRAFT");
    expect(applicationCreateMock).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Case 2: CANCELLED contract — throws InvalidStateTransitionError
  // -------------------------------------------------------------------------

  it("2. throws InvalidStateTransitionError for a CANCELLED contract", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    contractFindUniqueMock.mockResolvedValue({ id: "contract_2", status: "CANCELLED" });

    await expect(
      createApplicationAction({ contractId: "contract_2", type: "省エネ補助金" }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);

    expect(applicationCreateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 3 & 4: changeApplicationStatusAction — valid and invalid transitions
// ---------------------------------------------------------------------------

describe("changeApplicationStatusAction", () => {
  it("3. valid transition DRAFT → SUBMITTED succeeds", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    applicationFindUniqueMock.mockResolvedValue(
      makeApplication({ status: "DRAFT" }),
    );
    applicationUpdateMock.mockResolvedValue(
      makeApplication({
        status: "SUBMITTED",
        submittedDate: new Date("2026-06-02T00:00:00Z"),
      }),
    );

    const result = await changeApplicationStatusAction({
      id: "app_1",
      status: "SUBMITTED",
    });

    expect(result.status).toBe("SUBMITTED");
    expect(applicationUpdateMock).toHaveBeenCalledOnce();
  });

  it("4. invalid transition DRAFT → APPROVED throws InvalidStateTransitionError", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    applicationFindUniqueMock.mockResolvedValue(
      makeApplication({ status: "DRAFT" }),
    );

    await expect(
      changeApplicationStatusAction({ id: "app_1", status: "APPROVED", confirmedAmount: "100000" }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);

    expect(applicationUpdateMock).not.toHaveBeenCalled();
  });

  it("5. APPROVED without confirmedAmount throws ZodError", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    applicationFindUniqueMock.mockResolvedValue(
      makeApplication({ status: "SUBMITTED" }),
    );

    await expect(
      changeApplicationStatusAction({ id: "app_1", status: "APPROVED" }),
    ).rejects.toThrow();

    expect(applicationUpdateMock).not.toHaveBeenCalled();
  });

  it("6. APPROVED with confirmedAmount succeeds", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    applicationFindUniqueMock.mockResolvedValue(
      makeApplication({ status: "SUBMITTED" }),
    );
    applicationUpdateMock.mockResolvedValue(
      makeApplication({
        status: "APPROVED",
        approvedDate: new Date("2026-06-10T00:00:00Z"),
        grantedAmount: { toString: () => "80000" },
      }),
    );

    const result = await changeApplicationStatusAction({
      id: "app_1",
      status: "APPROVED",
      confirmedAmount: "80000",
    });

    expect(result.status).toBe("APPROVED");
    expect(result.confirmedAmount).toBe("80000");
    expect(applicationUpdateMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Case: updateApplicationAction — not found
// ---------------------------------------------------------------------------

describe("updateApplicationAction", () => {
  it("throws NotFoundError when application does not exist", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    applicationFindUniqueMock.mockResolvedValue(null);

    await expect(
      updateApplicationAction({ id: "non_existent" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(applicationUpdateMock).not.toHaveBeenCalled();
  });
});
