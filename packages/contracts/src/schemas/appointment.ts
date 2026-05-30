// Zod schemas for Appointment create / update / cancel (T-04-08 / F-033 /
// docs/05 §3.5 §4.7).
//
// Status transition table (docs/02 §F-033):
//   UNCONFIRMED → PRE_CALL_DONE, VISITED, ABSENT, CANCELLED, RESCHEDULED
//   PRE_CALL_DONE → VISITED, ABSENT, CANCELLED, RESCHEDULED
//   VISITED → (terminal — no transitions)
//   ABSENT → RESCHEDULED, CANCELLED
//   RESCHEDULED → UNCONFIRMED
//   CANCELLED → (terminal — no transitions)
//
// `AppointmentCancelSchema` is kept separate so callers that only cancel can
// import a tighter surface without the full update shape.

import { z } from "zod";

export const AppointmentStatusEnum = z.enum([
  "UNCONFIRMED",
  "PRE_CALL_DONE",
  "VISITED",
  "ABSENT",
  "CANCELLED",
  "RESCHEDULED",
]);

export type AppointmentStatus = z.infer<typeof AppointmentStatusEnum>;

// Allowed transitions: source → Set<target>
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, ReadonlySet<AppointmentStatus>> = {
  UNCONFIRMED: new Set(["PRE_CALL_DONE", "VISITED", "ABSENT", "CANCELLED", "RESCHEDULED"]),
  PRE_CALL_DONE: new Set(["VISITED", "ABSENT", "CANCELLED", "RESCHEDULED"]),
  VISITED: new Set(),
  ABSENT: new Set(["RESCHEDULED", "CANCELLED"]),
  RESCHEDULED: new Set(["UNCONFIRMED"]),
  CANCELLED: new Set(),
};

export function isValidStatusTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}

export const AppointmentCreateSchema = z.object({
  customerId: z.string().min(1, "顧客 ID が必要です"),
  eventId: z.string().optional(),
  scheduledAt: z.string().datetime({ message: "訪問予定日時は ISO 8601 形式で入力してください" }),
  location: z.string().max(500).optional(),
  // acquiredRelationshipId is taken from ctx in the action layer;
  // still present in the schema so dealer actions can pass it explicitly.
  acquiredRelationshipId: z.string().optional(),
  appointmentType: z.string().max(100).optional(),
  status: AppointmentStatusEnum.optional().default("UNCONFIRMED"),
  note: z.string().max(2000).optional(),
});

// Use z.input so `status` stays optional at the call site (schema default applies).
export type AppointmentCreateInput = z.input<typeof AppointmentCreateSchema>;

// Status transition validation happens in the action layer (which always reads
// `existing.status` from DB), not in the schema. The schema only normalises
// the update payload.
export const AppointmentUpdateSchema = z.object({
  id: z.string().min(1, "アポ ID が必要です"),
  scheduledAt: z
    .string()
    .datetime({ message: "訪問予定日時は ISO 8601 形式で入力してください" })
    .optional(),
  location: z.string().max(500).optional(),
  appointmentType: z.string().max(100).optional(),
  status: AppointmentStatusEnum.optional(),
  note: z.string().max(2000).optional(),
});

export type AppointmentUpdateInput = z.infer<typeof AppointmentUpdateSchema>;

export const AppointmentCancelSchema = z.object({
  id: z.string().min(1, "アポ ID が必要です"),
  reason: z.string().trim().max(2000).optional(),
});

export type AppointmentCancelInput = z.infer<typeof AppointmentCancelSchema>;
