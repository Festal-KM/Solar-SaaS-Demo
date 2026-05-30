// Unit tests for appointment Server Actions (T-04-08 / F-033 / docs/05 §4.7).
//
// Covers:
//   1. Successful appointment creation.
//   2. Status transition UNCONFIRMED → PRE_CALL_DONE (valid).
//   3. Invalid transition VISITED → UNCONFIRMED → InvalidStateTransitionError.
//   4. cancelAppointmentAction accepts optional reason; preserves existing note.
//
// Mock strategy mirrors the customer action tests in T-04-06.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvalidStateTransitionError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const appointmentCreateMock = vi.fn();
const appointmentFindUniqueMock = vi.fn();
const appointmentUpdateMock = vi.fn();
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
      create: (...args: unknown[]) => appointmentCreateMock(...args),
      findUnique: (...args: unknown[]) => appointmentFindUniqueMock(...args),
      update: (...args: unknown[]) => appointmentUpdateMock(...args),
    },
  };
  return {
    ...actual,
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const {
  createAppointmentAction,
  updateAppointmentAction,
  cancelAppointmentAction,
} = await import("../actions.js");

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

beforeEach(() => {
  authMock.mockReset();
  appointmentCreateMock.mockReset();
  appointmentFindUniqueMock.mockReset();
  appointmentUpdateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("createAppointmentAction", () => {
  it("creates an appointment and returns the new id", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    appointmentCreateMock.mockResolvedValue({ id: "appt_1" });

    const result = await createAppointmentAction({
      customerId: "cust_1",
      scheduledAt: "2026-06-15T10:00:00.000Z",
      status: "UNCONFIRMED",
    });

    expect(result).toEqual({ id: "appt_1" });
    expect(appointmentCreateMock).toHaveBeenCalledTimes(1);

    const call = appointmentCreateMock.mock.calls[0]![0] as {
      data: { customerId: string; status: string; acquiredOrgType: string };
    };
    expect(call.data.customerId).toBe("cust_1");
    expect(call.data.status).toBe("UNCONFIRMED");
    expect(call.data.acquiredOrgType).toBe("WHOLESALER");
    expect(revalidatePathMock).toHaveBeenCalledWith("/appointments");
  });
});

describe("updateAppointmentAction — valid transition", () => {
  it("allows UNCONFIRMED → PRE_CALL_DONE", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    appointmentFindUniqueMock.mockResolvedValue({ id: "appt_2", status: "UNCONFIRMED" });
    appointmentUpdateMock.mockResolvedValue({ id: "appt_2" });

    const result = await updateAppointmentAction({
      id: "appt_2",
      status: "PRE_CALL_DONE",
    });

    expect(result).toEqual({ id: "appt_2" });
    const updateCall = appointmentUpdateMock.mock.calls[0]![0] as {
      data: { status: string };
    };
    expect(updateCall.data.status).toBe("PRE_CALL_DONE");
  });
});

describe("updateAppointmentAction — invalid transition", () => {
  it("throws InvalidStateTransitionError for VISITED → UNCONFIRMED", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    // DB returns existing status VISITED (terminal — no outgoing transitions)
    appointmentFindUniqueMock.mockResolvedValue({ id: "appt_3", status: "VISITED" });

    await expect(
      updateAppointmentAction({
        id: "appt_3",
        status: "UNCONFIRMED",
      }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);

    expect(appointmentUpdateMock).not.toHaveBeenCalled();
  });
});

describe("cancelAppointmentAction", () => {
  it("cancels with reason, prepends reason before existing note", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    appointmentFindUniqueMock.mockResolvedValue({
      id: "appt_4",
      status: "UNCONFIRMED",
      note: "既存メモ",
    });
    appointmentUpdateMock.mockResolvedValue({ id: "appt_4" });

    const result = await cancelAppointmentAction({
      id: "appt_4",
      reason: "顧客都合でキャンセル",
    });

    expect(result).toEqual({ id: "appt_4" });
    const updateCall = appointmentUpdateMock.mock.calls[0]![0] as {
      data: { status: string; note: string };
    };
    expect(updateCall.data.status).toBe("CANCELLED");
    expect(updateCall.data.note).toBe("顧客都合でキャンセル\n---\n既存メモ");
  });

  it("cancels without reason — existing note is preserved unchanged", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    appointmentFindUniqueMock.mockResolvedValue({
      id: "appt_5",
      status: "UNCONFIRMED",
      note: "既存メモ",
    });
    appointmentUpdateMock.mockResolvedValue({ id: "appt_5" });

    const result = await cancelAppointmentAction({ id: "appt_5" });

    expect(result).toEqual({ id: "appt_5" });
    const updateCall = appointmentUpdateMock.mock.calls[0]![0] as {
      data: { status: string; note: string };
    };
    expect(updateCall.data.status).toBe("CANCELLED");
    expect(updateCall.data.note).toBe("既存メモ");
  });

  it("cancels without reason and no existing note — note remains null", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    appointmentFindUniqueMock.mockResolvedValue({
      id: "appt_6",
      status: "UNCONFIRMED",
      note: null,
    });
    appointmentUpdateMock.mockResolvedValue({ id: "appt_6" });

    const result = await cancelAppointmentAction({ id: "appt_6" });

    expect(result).toEqual({ id: "appt_6" });
    const updateCall = appointmentUpdateMock.mock.calls[0]![0] as {
      data: { status: string; note: string | null };
    };
    expect(updateCall.data.status).toBe("CANCELLED");
    expect(updateCall.data.note).toBeNull();
  });

  it("accepts blank (whitespace-only) reason — treated as no reason", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    appointmentFindUniqueMock.mockResolvedValue({
      id: "appt_7",
      status: "UNCONFIRMED",
      note: null,
    });
    appointmentUpdateMock.mockResolvedValue({ id: "appt_7" });

    // blank string trims to "" → filtered out → note remains null
    const result = await cancelAppointmentAction({ id: "appt_7", reason: "   " });

    expect(result).toEqual({ id: "appt_7" });
    const updateCall = appointmentUpdateMock.mock.calls[0]![0] as {
      data: { status: string; note: string | null };
    };
    expect(updateCall.data.note).toBeNull();
  });
});
