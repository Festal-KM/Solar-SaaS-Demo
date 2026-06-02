"use server";

// Customer Server Actions for wholesaler role group (T-04-06 / F-031 /
// docs/05 §4.7).
//
// Both actions run through the canonical three-step idiom:
//   auth → assertCan → withTenant tx.
//
// Security:
//   - wholesalerId is ALWAYS taken from ctx, never from input.
//   - ownerRelationshipId is taken from ctx.relationshipIds[0] for dealers;
//     for wholesalers it can be null (self-hosted) or provided explicitly.
//
// Duplicate phone:
//   - docs/02 §F-031 specifies a warning (not a hard error) when another
//     customer with the same phone exists in the same wholesaler tenant.
//   - We return `{ id, duplicatePhoneWarning: true }` so the UI can surface
//     a toast without blocking the save.

import { revalidatePath } from "next/cache";

import { CustomerCreateSchema, CustomerUpdateSchema } from "@solar/contracts";
import type { CustomerCreateInput, CustomerUpdateInput } from "@solar/contracts";

import { NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/customers";

export interface CreateCustomerResult {
  id: string;
  duplicatePhoneWarning: boolean;
}

export const createCustomerAction = withServerActionContext<
  CustomerCreateInput,
  CreateCustomerResult
>(
  {
    action: "customer.create",
  },
  async ({ tx, ctx, input }) => {
    const parsed = CustomerCreateSchema.parse(input);

    // wholesalerId is injected from ctx — callers MUST NOT supply it.
    const wholesalerId = ctx.wholesalerId!;

    // Duplicate phone check within same wholesaler tenant (warning, not error).
    const dupPhone = await tx.customer.findFirst({
      where: { wholesalerId, phone: parsed.phone },
      select: { id: true },
    });

    const registeredByOrgType = ctx.dealerId ? "DEALER" : "WHOLESALER";

    const created = await tx.customer.create({
      data: {
        wholesalerId,
        ownerRelationshipId: parsed.ownerRelationshipId ?? null,
        name: parsed.name,
        kana: parsed.kana ?? null,
        phone: parsed.phone,
        email: parsed.email ?? null,
        postalCode: parsed.postalCode ?? null,
        address: parsed.address ?? null,
        housingType: parsed.housingType ?? null,
        pvInstalled: parsed.pvInstalled ?? null,
        batteryInstalled: parsed.batteryInstalled ?? null,
        electricBill: parsed.electricBill ?? null,
        household: parsed.household ?? null,
        channel: parsed.channel,
        sourceEventId: parsed.sourceEventId ?? null,
        registeredByUserId: ctx.actorUserId,
        registeredByOrgType,
        registeredByRelationshipId: parsed.ownerRelationshipId ?? null,
        status: parsed.status,
        note: parsed.note ?? null,
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    return { id: created.id, duplicatePhoneWarning: !!dupPhone };
  },
);

export interface UpdateCustomerResult {
  id: string;
  duplicatePhoneWarning: boolean;
}

export const updateCustomerAction = withServerActionContext<
  CustomerUpdateInput,
  UpdateCustomerResult
>(
  {
    action: "customer.update",
  },
  async ({ tx, ctx, input }) => {
    const parsed = CustomerUpdateSchema.parse(input);

    const existing = await tx.customer.findUnique({
      where: { id: parsed.id },
      select: { id: true, phone: true, wholesalerId: true },
    });
    if (!existing) {
      throw new NotFoundError("顧客が見つかりません");
    }

    const wholesalerId = existing.wholesalerId;

    // Duplicate phone warning when phone is changing to an already-used number.
    let duplicatePhoneWarning = false;
    if (parsed.phone && parsed.phone !== existing.phone) {
      const dup = await tx.customer.findFirst({
        where: { wholesalerId, phone: parsed.phone, NOT: { id: parsed.id } },
        select: { id: true },
      });
      duplicatePhoneWarning = !!dup;
    }

    const updated = await tx.customer.update({
      where: { id: parsed.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.kana !== undefined ? { kana: parsed.kana } : {}),
        ...(parsed.phone !== undefined ? { phone: parsed.phone } : {}),
        ...(parsed.email !== undefined ? { email: parsed.email } : {}),
        ...(parsed.postalCode !== undefined ? { postalCode: parsed.postalCode } : {}),
        ...(parsed.address !== undefined ? { address: parsed.address } : {}),
        ...(parsed.area !== undefined
          ? { area: parsed.area && parsed.area.length > 0 ? parsed.area : null }
          : {}),
        ...(parsed.registeredByUserId !== undefined
          ? { registeredByUserId: parsed.registeredByUserId }
          : {}),
        ...(parsed.tossUpUserId !== undefined ? { tossUpUserId: parsed.tossUpUserId } : {}),
        ...(parsed.tossUpRelationshipId !== undefined
          ? { tossUpRelationshipId: parsed.tossUpRelationshipId }
          : {}),
        ...(parsed.closingUserId !== undefined ? { closingUserId: parsed.closingUserId } : {}),
        ...(parsed.closingRelationshipId !== undefined
          ? { closingRelationshipId: parsed.closingRelationshipId }
          : {}),
        ...(parsed.housingType !== undefined ? { housingType: parsed.housingType } : {}),
        ...(parsed.pvInstalled !== undefined ? { pvInstalled: parsed.pvInstalled } : {}),
        ...(parsed.batteryInstalled !== undefined
          ? { batteryInstalled: parsed.batteryInstalled }
          : {}),
        ...(parsed.electricBill !== undefined ? { electricBill: parsed.electricBill } : {}),
        ...(parsed.household !== undefined ? { household: parsed.household } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed.note !== undefined ? { note: parsed.note } : {}),
        ...(parsed.inflowRoute !== undefined ? { inflowRoute: parsed.inflowRoute } : {}),
        ...(parsed.maekakuStatus !== undefined ? { maekakuStatus: parsed.maekakuStatus } : {}),
        ...(parsed.nextAction !== undefined
          ? { nextAction: parsed.nextAction?.trim() || null }
          : {}),
        ...(parsed.nextAppointmentAt !== undefined
          ? { nextAppointmentAt: parsed.nextAppointmentAt ? new Date(parsed.nextAppointmentAt) : null }
          : {}),
        ...(parsed.contractStatus !== undefined ? { contractStatus: parsed.contractStatus } : {}),
        ...(parsed.contractPlan !== undefined
          ? { contractPlan: parsed.contractPlan?.trim() || null }
          : {}),
        ...(parsed.contractAmount !== undefined ? { contractAmount: parsed.contractAmount } : {}),
        ...(parsed.contractExpectedDate !== undefined
          ? { contractExpectedDate: parsed.contractExpectedDate ? new Date(parsed.contractExpectedDate) : null }
          : {}),
        ...(parsed.constructionStatus !== undefined
          ? { constructionStatus: parsed.constructionStatus }
          : {}),
        ...(parsed.constructionPlannedDate !== undefined
          ? { constructionPlannedDate: parsed.constructionPlannedDate ? new Date(parsed.constructionPlannedDate) : null }
          : {}),
        ...(parsed.constructionCompletedDate !== undefined
          ? { constructionCompletedDate: parsed.constructionCompletedDate ? new Date(parsed.constructionCompletedDate) : null }
          : {}),
        ...(parsed.constructionVendor !== undefined
          ? { constructionVendor: parsed.constructionVendor?.trim() || null }
          : {}),
        ...(parsed.subsidyStatus !== undefined ? { subsidyStatus: parsed.subsidyStatus } : {}),
        ...(parsed.subsidyType !== undefined
          ? { subsidyType: parsed.subsidyType?.trim() || null }
          : {}),
        ...(parsed.subsidySubmittedDate !== undefined
          ? { subsidySubmittedDate: parsed.subsidySubmittedDate ? new Date(parsed.subsidySubmittedDate) : null }
          : {}),
        ...(parsed.subsidyGrantedDate !== undefined
          ? { subsidyGrantedDate: parsed.subsidyGrantedDate ? new Date(parsed.subsidyGrantedDate) : null }
          : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${parsed.id}`);
    return { id: updated.id, duplicatePhoneWarning };
  },
);
