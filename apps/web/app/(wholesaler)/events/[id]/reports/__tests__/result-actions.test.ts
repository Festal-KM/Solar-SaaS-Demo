// Unit tests for EventReport result Server Action (T-04-04 / F-030 /
// docs/05 §4.6).
//
// Tests cover:
//   1. Normal RESULT creation — success path
//   2. validAppts + invalidAppts > totalAppts → ValidationError (Zod)
//   3. Negative number → ValidationError (Zod)
//   4. Duplicate RESULT → ConflictError (409)

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError } from "../../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const eventFindUniqueMock = vi.fn();
const reportFindFirstMock = vi.fn();
const reportCreateMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    event: {
      findUnique: (...args: unknown[]) => eventFindUniqueMock(...args),
    },
    eventReport: {
      findFirst: (...args: unknown[]) => reportFindFirstMock(...args),
      create: (...args: unknown[]) => reportCreateMock(...args),
    },
  };
  return {
    ...actual,
    rawPrisma: {
      relationship: {
        findMany: (...args: unknown[]) => relationshipFindManyMock(...args),
      },
    },
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { submitResultReportAction } = await import("../actions.js");

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

const EXISTING_EVENT = {
  id: "ev_1",
  wholesalerId: "tenant_ws_a",
};

const VALID_INPUT = {
  eventId: "ev_1",
  approachCount: 100,
  surveyCount: 50,
  totalAppts: 20,
  validAppts: 15,
  invalidAppts: 5,
  comment: "テストコメント",
};

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  eventFindUniqueMock.mockReset();
  reportFindFirstMock.mockReset();
  reportCreateMock.mockReset();
  revalidatePathMock.mockReset();
});

// ── Test 1: Normal RESULT creation ───────────────────────────────────────────

describe("submitResultReportAction — success", () => {
  it("creates an EventReport with type RESULT and returns reportId / eventId", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue(EXISTING_EVENT);
    reportFindFirstMock.mockResolvedValue(null); // no duplicate
    reportCreateMock.mockResolvedValue({ id: "rpt_result_1", eventId: "ev_1" });

    const result = await submitResultReportAction(VALID_INPUT);

    expect(result.reportId).toBe("rpt_result_1");
    expect(result.eventId).toBe("ev_1");

    const createCall = reportCreateMock.mock.calls[0]![0] as {
      data: {
        type: string;
        reporterOrgType: string;
        reporterUserId: string;
        payload: {
          approachCount: number;
          surveyCount: number;
          totalAppts: number;
          validAppts: number;
          invalidAppts: number;
        };
      };
    };
    expect(createCall.data.type).toBe("RESULT");
    expect(createCall.data.reporterOrgType).toBe("WHOLESALER");
    expect(createCall.data.reporterUserId).toBe("u_ws_admin");
    expect(createCall.data.payload.approachCount).toBe(100);
    expect(createCall.data.payload.validAppts).toBe(15);
    expect(createCall.data.payload.invalidAppts).toBe(5);

    expect(revalidatePathMock).toHaveBeenCalledWith("/events/ev_1");
  });
});

// ── Test 2: validAppts + invalidAppts > totalAppts → Zod ValidationError ─────

describe("submitResultReportAction — appts sum exceeds totalAppts", () => {
  it("throws a Zod parse error when validAppts + invalidAppts > totalAppts", async () => {
    authMock.mockResolvedValue(WS_SESSION);

    await expect(
      submitResultReportAction({
        ...VALID_INPUT,
        totalAppts: 10,
        validAppts: 8,
        invalidAppts: 5, // 8 + 5 = 13 > 10
      }),
    ).rejects.toThrow();

    expect(reportCreateMock).not.toHaveBeenCalled();
  });
});

// ── Test 3: Negative number → Zod ValidationError ────────────────────────────

describe("submitResultReportAction — negative count", () => {
  it("throws a Zod parse error when approachCount is negative", async () => {
    authMock.mockResolvedValue(WS_SESSION);

    await expect(
      submitResultReportAction({
        ...VALID_INPUT,
        approachCount: -1,
      }),
    ).rejects.toThrow();

    expect(reportCreateMock).not.toHaveBeenCalled();
  });
});

// ── Test 4: Duplicate RESULT → ConflictError ─────────────────────────────────

describe("submitResultReportAction — duplicate", () => {
  it("throws ConflictError (409) when a RESULT for WHOLESALER already exists", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue(EXISTING_EVENT);
    reportFindFirstMock.mockResolvedValue({ id: "rpt_existing_result" }); // duplicate

    await expect(submitResultReportAction(VALID_INPUT)).rejects.toBeInstanceOf(ConflictError);

    expect(reportCreateMock).not.toHaveBeenCalled();
  });
});
