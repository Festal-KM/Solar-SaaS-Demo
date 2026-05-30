// Unit tests for recordPreCallAction (T-04-09 / F-035 / docs/05 §4.7).
//
// Covers:
//   1. APPROVED → Appointment.status updated to PRE_CALL_DONE.
//   2. RESCHEDULED → Appointment.status = RESCHEDULED + scheduledAt updated.
//   3. RESCHEDULED without rescheduledAt → Zod ValidationError (ZodError).
//   4. CANCELLED → Appointment.status updated to CANCELLED.
//   5. ABSENT → Appointment.status unchanged (no update call).
//   6. Duplicate PreCall → ConflictError.
//
// Mock strategy mirrors T-04-08 appointment actions tests.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError } from "../../../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const appointmentFindUniqueMock = vi.fn();
const appointmentUpdateMock = vi.fn();
const preCallCreateMock = vi.fn();
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
    appointment: {
      findUnique: (...args: unknown[]) => appointmentFindUniqueMock(...args),
      update: (...args: unknown[]) => appointmentUpdateMock(...args),
    },
    preCall: {
      create: (...args: unknown[]) => preCallCreateMock(...args),
    },
  };
  return {
    ...actual,
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { recordPreCallAction } = await import("../actions.js");

const WS_CALL_SESSION = {
  user: {
    id: "u_call",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_CALL_TEAM"],
    isSaasAdmin: false,
  },
};

beforeEach(() => {
  authMock.mockReset();
  appointmentFindUniqueMock.mockReset();
  appointmentUpdateMock.mockReset();
  preCallCreateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("recordPreCallAction — APPROVED", () => {
  it("creates PreCall and updates Appointment status to PRE_CALL_DONE", async () => {
    authMock.mockResolvedValue(WS_CALL_SESSION);
    appointmentFindUniqueMock.mockResolvedValue({
      id: "appt_1",
      status: "UNCONFIRMED",
      preCall: null,
    });
    preCallCreateMock.mockResolvedValue({ id: "pc_1" });
    appointmentUpdateMock.mockResolvedValue({ id: "appt_1" });

    const result = await recordPreCallAction({
      appointmentId: "appt_1",
      result: "APPROVED",
    });

    expect(result).toEqual({ id: "pc_1" });
    expect(preCallCreateMock).toHaveBeenCalledTimes(1);
    const createCall = preCallCreateMock.mock.calls[0]![0] as {
      data: { result: string; appointmentId: string };
    };
    expect(createCall.data.result).toBe("APPROVED");
    expect(createCall.data.appointmentId).toBe("appt_1");

    expect(appointmentUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall = appointmentUpdateMock.mock.calls[0]![0] as {
      data: { status: string };
    };
    expect(updateCall.data.status).toBe("PRE_CALL_DONE");
  });
});

describe("recordPreCallAction — RESCHEDULED", () => {
  it("creates PreCall, sets status to RESCHEDULED, and updates scheduledAt", async () => {
    authMock.mockResolvedValue(WS_CALL_SESSION);
    appointmentFindUniqueMock.mockResolvedValue({
      id: "appt_2",
      status: "UNCONFIRMED",
      preCall: null,
    });
    preCallCreateMock.mockResolvedValue({ id: "pc_2" });
    appointmentUpdateMock.mockResolvedValue({ id: "appt_2" });

    const newDate = "2026-07-01T10:00:00.000Z";
    const result = await recordPreCallAction({
      appointmentId: "appt_2",
      result: "RESCHEDULED",
      rescheduledAt: newDate,
    });

    expect(result).toEqual({ id: "pc_2" });

    const updateCall = appointmentUpdateMock.mock.calls[0]![0] as {
      data: { status: string; scheduledAt: Date };
    };
    expect(updateCall.data.status).toBe("RESCHEDULED");
    expect(updateCall.data.scheduledAt).toEqual(new Date(newDate));
  });
});

describe("recordPreCallAction — RESCHEDULED without rescheduledAt", () => {
  it("throws ZodError when rescheduledAt is missing", async () => {
    authMock.mockResolvedValue(WS_CALL_SESSION);
    // The Zod refine fires before any DB access, so no need to mock DB here.

    await expect(
      recordPreCallAction({
        appointmentId: "appt_3",
        result: "RESCHEDULED",
        // rescheduledAt deliberately omitted
      }),
    ).rejects.toThrow();

    expect(preCallCreateMock).not.toHaveBeenCalled();
    expect(appointmentUpdateMock).not.toHaveBeenCalled();
  });
});

describe("recordPreCallAction — CANCELLED", () => {
  it("creates PreCall and updates Appointment status to CANCELLED", async () => {
    authMock.mockResolvedValue(WS_CALL_SESSION);
    appointmentFindUniqueMock.mockResolvedValue({
      id: "appt_4",
      status: "UNCONFIRMED",
      preCall: null,
    });
    preCallCreateMock.mockResolvedValue({ id: "pc_4" });
    appointmentUpdateMock.mockResolvedValue({ id: "appt_4" });

    const result = await recordPreCallAction({
      appointmentId: "appt_4",
      result: "CANCELLED",
    });

    expect(result).toEqual({ id: "pc_4" });

    const updateCall = appointmentUpdateMock.mock.calls[0]![0] as {
      data: { status: string };
    };
    expect(updateCall.data.status).toBe("CANCELLED");
  });
});

describe("recordPreCallAction — ABSENT", () => {
  it("creates PreCall but does NOT update Appointment status", async () => {
    authMock.mockResolvedValue(WS_CALL_SESSION);
    appointmentFindUniqueMock.mockResolvedValue({
      id: "appt_5",
      status: "UNCONFIRMED",
      preCall: null,
    });
    preCallCreateMock.mockResolvedValue({ id: "pc_5" });

    const result = await recordPreCallAction({
      appointmentId: "appt_5",
      result: "ABSENT",
    });

    expect(result).toEqual({ id: "pc_5" });
    expect(appointmentUpdateMock).not.toHaveBeenCalled();
  });
});

describe("recordPreCallAction — duplicate", () => {
  it("throws ConflictError when PreCall already exists for appointment", async () => {
    authMock.mockResolvedValue(WS_CALL_SESSION);
    appointmentFindUniqueMock.mockResolvedValue({
      id: "appt_6",
      status: "PRE_CALL_DONE",
      preCall: { id: "pc_existing" },
    });

    await expect(
      recordPreCallAction({
        appointmentId: "appt_6",
        result: "APPROVED",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(preCallCreateMock).not.toHaveBeenCalled();
  });
});
