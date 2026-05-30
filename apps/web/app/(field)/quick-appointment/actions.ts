"use server";

// Quick-appointment Server Action (T-04-11 / F-031 / F-033 / docs/05 §4.7).
//
// Creates a Customer and an Appointment in one transaction.
// Intended for wholesaler_field_staff on the field dashboard (S-057).
//
// Security:
//   - wholesalerId is taken from ctx — never from input.
//   - sourceEventId is required (channel is always EVENT for field capture).
//   - Duplicate phone triggers a warning, not a hard error (same behaviour as
//     the full customer.create action in T-04-06).

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withServerActionContext } from "@/lib/tenancy/server-action";

// 「"use server"」ファイルは runtime 値（オブジェクト）の export 不可。型のみ OK。
const QuickAppointmentSchema = z.object({
  // Customer fields
  name: z.string().trim().min(1, "氏名を入力してください").max(255),
  phone: z.string().trim().min(1, "電話番号を入力してください").max(50),
  // sourceEventId is mandatory for EVENT channel captures
  sourceEventId: z.string().trim().min(1, "催事 ID を入力してください"),
  // Appointment fields
  scheduledAt: z
    .string()
    .datetime({ message: "訪問予定日時は ISO 8601 形式で入力してください" }),
  note: z.string().max(2000).optional(),
});

type QuickAppointmentInput = z.input<typeof QuickAppointmentSchema>;

export interface QuickAppointmentResult {
  customerId: string;
  appointmentId: string;
  duplicatePhoneWarning: boolean;
}

export const quickAppointmentAction = withServerActionContext<
  QuickAppointmentInput,
  QuickAppointmentResult
>(
  { action: "quick_appointment.create" },
  async ({ tx, ctx, input }) => {
    const parsed = QuickAppointmentSchema.parse(input);

    const wholesalerId = ctx.wholesalerId!;

    // Duplicate phone warning within same wholesaler tenant (non-blocking).
    const dupPhone = await tx.customer.findFirst({
      where: { wholesalerId, phone: parsed.phone },
      select: { id: true },
    });

    const registeredByOrgType = "WHOLESALER";

    const customer = await tx.customer.create({
      data: {
        wholesalerId,
        name: parsed.name,
        phone: parsed.phone,
        channel: "EVENT",
        sourceEventId: parsed.sourceEventId,
        registeredByUserId: ctx.actorUserId,
        registeredByOrgType,
        status: "NEW",
        note: parsed.note ?? null,
      },
      select: { id: true },
    });

    const appointment = await tx.appointment.create({
      data: {
        customerId: customer.id,
        eventId: parsed.sourceEventId,
        scheduledAt: new Date(parsed.scheduledAt),
        acquiredByUserId: ctx.actorUserId,
        acquiredOrgType: registeredByOrgType,
        acquiredRelationshipId: null,
        status: "UNCONFIRMED",
        note: parsed.note ?? null,
      },
      select: { id: true },
    });

    revalidatePath("/customers");
    revalidatePath("/appointments");

    return {
      customerId: customer.id,
      appointmentId: appointment.id,
      duplicatePhoneWarning: !!dupPhone,
    };
  },
);
