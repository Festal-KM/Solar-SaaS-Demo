// Unit tests for dealer EventReport start / end Server Actions (T-04-03 /
// F-028 / F-029 / docs/05 §4.6).
//
// Tests cover:
//   1. Normal dealer START creation — success path
//   2. Duplicate dealer START → ConflictError (409)
//   3. Dealer access to an event they are not assigned to → NotFoundError (404)

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "../../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const eventDealerFindFirstMock = vi.fn();
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
    eventDealer: {
      findFirst: (...args: unknown[]) => eventDealerFindFirstMock(...args),
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

const { submitDealerStartReportAction, submitDealerEndReportAction } = await import(
  "../actions.js"
);

const DEALER_SESSION = {
  user: {
    id: "u_dealer_1",
    tenantId: "tenant_dl_x",
    tenantType: "DEALER",
    wholesalerId: "tenant_ws_a",
    dealerId: "tenant_dl_x",
    roles: ["DEALER_ADMIN"],
    isSaasAdmin: false,
  },
};

const ASSIGNED_EVENT_DEALER = {
  relationshipId: "rel_a_x",
  event: { id: "ev_1" },
};

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  eventDealerFindFirstMock.mockReset();
  reportFindFirstMock.mockReset();
  reportCreateMock.mockReset();
  revalidatePathMock.mockReset();

  // Default: authenticated dealer with one active relationship.
  authMock.mockResolvedValue(DEALER_SESSION);
  relationshipFindManyMock.mockResolvedValue([{ id: "rel_a_x" }]);
});

// ── Test 1: normal dealer START creation ────────────────────────────────────

describe("submitDealerStartReportAction — success", () => {
  it("creates an EventReport with type START and reporterOrgType DEALER", async () => {
    eventDealerFindFirstMock.mockResolvedValue(ASSIGNED_EVENT_DEALER);
    reportFindFirstMock.mockResolvedValue(null); // no duplicate
    reportCreateMock.mockResolvedValue({ id: "rpt_dealer_start_1", eventId: "ev_1" });

    const result = await submitDealerStartReportAction({ eventId: "ev_1" });

    expect(result.reportId).toBe("rpt_dealer_start_1");
    expect(result.eventId).toBe("ev_1");
    expect(result.warning).toBeUndefined();

    const createCall = reportCreateMock.mock.calls[0]![0] as {
      data: {
        eventId: string;
        type: string;
        reporterOrgType: string;
        reporterUserId: string;
        payload: { comment: null; attachments: []; relationshipId: string };
      };
    };
    expect(createCall.data.type).toBe("START");
    expect(createCall.data.reporterOrgType).toBe("DEALER");
    expect(createCall.data.reporterUserId).toBe("u_dealer_1");
    expect(createCall.data.payload.relationshipId).toBe("rel_a_x");

    expect(revalidatePathMock).toHaveBeenCalledWith("/d-events/ev_1");
  });
});

// ── Test 2: duplicate dealer START → ConflictError ──────────────────────────

describe("submitDealerStartReportAction — duplicate", () => {
  it("throws ConflictError (409) when a DEALER START for this event already exists", async () => {
    eventDealerFindFirstMock.mockResolvedValue(ASSIGNED_EVENT_DEALER);
    // Duplicate check returns an existing report.
    reportFindFirstMock.mockResolvedValue({ id: "rpt_existing" });

    await expect(submitDealerStartReportAction({ eventId: "ev_1" })).rejects.toBeInstanceOf(
      ConflictError,
    );

    expect(reportCreateMock).not.toHaveBeenCalled();
  });
});

// ── Test 3: dealer access to an event they are not assigned to → NotFoundError

describe("submitDealerStartReportAction — not assigned", () => {
  it("throws NotFoundError (404) when the dealer is not in EventDealer for this event", async () => {
    // EventDealer membership check finds nothing.
    eventDealerFindFirstMock.mockResolvedValue(null);

    await expect(submitDealerStartReportAction({ eventId: "ev_other" })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    expect(reportFindFirstMock).not.toHaveBeenCalled();
    expect(reportCreateMock).not.toHaveBeenCalled();
  });
});

// ── Bonus: END without prior START → warning, not error ─────────────────────

describe("submitDealerEndReportAction — START missing warning", () => {
  it("creates END report and returns warning START_MISSING when no DEALER START exists", async () => {
    eventDealerFindFirstMock.mockResolvedValue(ASSIGNED_EVENT_DEALER);
    reportFindFirstMock
      .mockResolvedValueOnce(null) // no duplicate END
      .mockResolvedValueOnce(null); // no prior START
    reportCreateMock.mockResolvedValue({ id: "rpt_dealer_end_1", eventId: "ev_1" });

    const result = await submitDealerEndReportAction({ eventId: "ev_1" });

    expect(result.reportId).toBe("rpt_dealer_end_1");
    expect(result.warning).toBe("START_MISSING");

    const createCall = reportCreateMock.mock.calls[0]![0] as {
      data: { type: string; reporterOrgType: string };
    };
    expect(createCall.data.type).toBe("END");
    expect(createCall.data.reporterOrgType).toBe("DEALER");
  });
});
