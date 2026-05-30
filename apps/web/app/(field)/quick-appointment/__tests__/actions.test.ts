// Unit tests for quickAppointmentAction (T-04-11 / F-031 / F-033).
//
// Covers:
//   1. Successful creation — customer + appointment IDs returned, no duplicate warning.
//   2. Duplicate phone — creates both records but sets duplicatePhoneWarning=true.
//   3. Missing name — Zod validation error.
//   4. Missing phone — Zod validation error.
//   5. WHOLESALER_EVENT_TEAM is NOT in the allow-list → ForbiddenError.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const customerCreateMock = vi.fn();
const customerFindFirstMock = vi.fn();
const appointmentCreateMock = vi.fn();
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
    customer: {
      create: (...args: unknown[]) => customerCreateMock(...args),
      findFirst: (...args: unknown[]) => customerFindFirstMock(...args),
    },
    appointment: {
      create: (...args: unknown[]) => appointmentCreateMock(...args),
    },
  };
  return {
    ...actual,
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { quickAppointmentAction } = await import("../actions.js");

const WS_FIELD_SESSION = {
  user: {
    id: "u_field_1",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_FIELD_STAFF"],
    isSaasAdmin: false,
  },
};

const VALID_INPUT = {
  name: "田中 一郎",
  phone: "090-1111-2222",
  sourceEventId: "event_abc",
  scheduledAt: "2026-06-20T10:00:00.000Z",
};

beforeEach(() => {
  authMock.mockReset();
  customerCreateMock.mockReset();
  customerFindFirstMock.mockReset();
  appointmentCreateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("quickAppointmentAction — successful creation", () => {
  it("creates customer and appointment, returns both IDs without duplicate warning", async () => {
    authMock.mockResolvedValue(WS_FIELD_SESSION);
    customerFindFirstMock.mockResolvedValue(null); // no duplicate
    customerCreateMock.mockResolvedValue({ id: "cust_1" });
    appointmentCreateMock.mockResolvedValue({ id: "appt_1" });

    const result = await quickAppointmentAction(VALID_INPUT);

    expect(result).toEqual({
      customerId: "cust_1",
      appointmentId: "appt_1",
      duplicatePhoneWarning: false,
    });

    // Customer should be created with EVENT channel and correct wholesalerId.
    expect(customerCreateMock).toHaveBeenCalledTimes(1);
    const custCall = customerCreateMock.mock.calls[0]![0] as {
      data: {
        wholesalerId: string;
        name: string;
        channel: string;
        sourceEventId: string;
        registeredByOrgType: string;
      };
    };
    expect(custCall.data.wholesalerId).toBe("tenant_ws_a");
    expect(custCall.data.name).toBe("田中 一郎");
    expect(custCall.data.channel).toBe("EVENT");
    expect(custCall.data.sourceEventId).toBe("event_abc");
    expect(custCall.data.registeredByOrgType).toBe("WHOLESALER");

    // Appointment should link to the newly created customer.
    expect(appointmentCreateMock).toHaveBeenCalledTimes(1);
    const apptCall = appointmentCreateMock.mock.calls[0]![0] as {
      data: {
        customerId: string;
        eventId: string;
        status: string;
        acquiredOrgType: string;
      };
    };
    expect(apptCall.data.customerId).toBe("cust_1");
    expect(apptCall.data.eventId).toBe("event_abc");
    expect(apptCall.data.status).toBe("UNCONFIRMED");
    expect(apptCall.data.acquiredOrgType).toBe("WHOLESALER");

    // Both cache paths should be revalidated.
    expect(revalidatePathMock).toHaveBeenCalledWith("/customers");
    expect(revalidatePathMock).toHaveBeenCalledWith("/appointments");
  });

  it("returns duplicatePhoneWarning=true when same phone already exists", async () => {
    authMock.mockResolvedValue(WS_FIELD_SESSION);
    customerFindFirstMock.mockResolvedValue({ id: "cust_existing" }); // duplicate
    customerCreateMock.mockResolvedValue({ id: "cust_2" });
    appointmentCreateMock.mockResolvedValue({ id: "appt_2" });

    const result = await quickAppointmentAction(VALID_INPUT);

    expect(result.duplicatePhoneWarning).toBe(true);
    expect(result.customerId).toBe("cust_2");
    expect(result.appointmentId).toBe("appt_2");
    // Customer should still be created despite the warning.
    expect(customerCreateMock).toHaveBeenCalledTimes(1);
  });
});

describe("quickAppointmentAction — validation errors", () => {
  it("rejects input with missing name", async () => {
    authMock.mockResolvedValue(WS_FIELD_SESSION);

    await expect(
      quickAppointmentAction({
        name: "",
        phone: "090-0000-0001",
        sourceEventId: "event_abc",
        scheduledAt: "2026-06-20T10:00:00.000Z",
      }),
    ).rejects.toThrow("氏名");

    expect(customerCreateMock).not.toHaveBeenCalled();
    expect(appointmentCreateMock).not.toHaveBeenCalled();
  });

  it("rejects input with missing phone", async () => {
    authMock.mockResolvedValue(WS_FIELD_SESSION);

    await expect(
      quickAppointmentAction({
        name: "田中 次郎",
        phone: "",
        sourceEventId: "event_abc",
        scheduledAt: "2026-06-20T10:00:00.000Z",
      }),
    ).rejects.toThrow("電話番号");

    expect(customerCreateMock).not.toHaveBeenCalled();
    expect(appointmentCreateMock).not.toHaveBeenCalled();
  });
});

describe("quickAppointmentAction — permission", () => {
  it("forbids WHOLESALER_EVENT_TEAM (not in allow-list)", async () => {
    authMock.mockResolvedValue({
      user: {
        ...WS_FIELD_SESSION.user,
        roles: ["WHOLESALER_EVENT_TEAM"],
      },
    });

    await expect(quickAppointmentAction(VALID_INPUT)).rejects.toBeInstanceOf(ForbiddenError);

    expect(customerCreateMock).not.toHaveBeenCalled();
    expect(appointmentCreateMock).not.toHaveBeenCalled();
  });
});
