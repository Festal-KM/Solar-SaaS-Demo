// Unit tests for EventReport start / end Server Actions (T-04-03 / F-028 / F-029).
//
// Tests cover:
//   1. START report — normal creation success path
//   2. Duplicate (same event / same org / same type) → ConflictError (409)
//   3. END report submitted without prior START → warning: "START_MISSING" (not an error)

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "../../../../../../lib/errors.js";

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

const { submitStartReportAction, submitEndReportAction } = await import("../actions.js");

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

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  eventFindUniqueMock.mockReset();
  reportFindFirstMock.mockReset();
  reportCreateMock.mockReset();
  revalidatePathMock.mockReset();
});

// ── Test 1: START report — normal creation ────────────────────────────────────

describe("submitStartReportAction — success", () => {
  it("creates an EventReport with type START and returns reportId / eventId", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue(EXISTING_EVENT);
    reportFindFirstMock.mockResolvedValue(null); // no duplicate
    reportCreateMock.mockResolvedValue({ id: "rpt_start_1", eventId: "ev_1" });

    const result = await submitStartReportAction({ eventId: "ev_1" });

    expect(result.reportId).toBe("rpt_start_1");
    expect(result.eventId).toBe("ev_1");
    expect(result.warning).toBeUndefined();

    const createCall = reportCreateMock.mock.calls[0]![0] as {
      data: {
        eventId: string;
        type: string;
        reporterOrgType: string;
        reporterUserId: string;
        payload: { comment: null; attachments: [] };
      };
    };
    expect(createCall.data.type).toBe("START");
    expect(createCall.data.reporterOrgType).toBe("WHOLESALER");
    expect(createCall.data.reporterUserId).toBe("u_ws_admin");

    expect(revalidatePathMock).toHaveBeenCalledWith("/events/ev_1");
  });
});

// ── Test 2: duplicate START → ConflictError ───────────────────────────────────

describe("submitStartReportAction — duplicate", () => {
  it("throws ConflictError (409) when a START for WHOLESALER already exists", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue(EXISTING_EVENT);
    // First findFirst call (duplicate check) returns existing report.
    reportFindFirstMock.mockResolvedValue({ id: "rpt_existing" });

    await expect(submitStartReportAction({ eventId: "ev_1" })).rejects.toBeInstanceOf(
      ConflictError,
    );

    expect(reportCreateMock).not.toHaveBeenCalled();
  });
});

// ── Test 3: END without prior START → warning, not error ─────────────────────

describe("submitEndReportAction — START missing warning", () => {
  it("creates END report and returns warning START_MISSING when no START exists", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue(EXISTING_EVENT);
    // First findFirst = duplicate END check (no duplicate).
    // Second findFirst = START existence check (no START).
    reportFindFirstMock
      .mockResolvedValueOnce(null) // no duplicate END
      .mockResolvedValueOnce(null); // no START exists
    reportCreateMock.mockResolvedValue({ id: "rpt_end_1", eventId: "ev_1" });

    const result = await submitEndReportAction({ eventId: "ev_1" });

    expect(result.reportId).toBe("rpt_end_1");
    expect(result.eventId).toBe("ev_1");
    expect(result.warning).toBe("START_MISSING");

    const createCall = reportCreateMock.mock.calls[0]![0] as {
      data: { type: string; reporterOrgType: string };
    };
    expect(createCall.data.type).toBe("END");
    expect(createCall.data.reporterOrgType).toBe("WHOLESALER");
  });

  it("creates END report without warning when START already exists", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    eventFindUniqueMock.mockResolvedValue(EXISTING_EVENT);
    reportFindFirstMock
      .mockResolvedValueOnce(null) // no duplicate END
      .mockResolvedValueOnce({ id: "rpt_start_1" }); // START exists
    reportCreateMock.mockResolvedValue({ id: "rpt_end_2", eventId: "ev_1" });

    const result = await submitEndReportAction({ eventId: "ev_1" });

    expect(result.warning).toBeUndefined();
  });
});

// ── Additional: cross-tenant isolation ───────────────────────────────────────

describe("submitStartReportAction — tenant isolation", () => {
  it("throws NotFoundError when event belongs to a different wholesaler", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    // Event belongs to a different wholesaler.
    eventFindUniqueMock.mockResolvedValue({ id: "ev_1", wholesalerId: "tenant_ws_other" });

    await expect(submitStartReportAction({ eventId: "ev_1" })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    expect(reportCreateMock).not.toHaveBeenCalled();
  });
});
