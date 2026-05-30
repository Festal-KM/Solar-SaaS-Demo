"use server";

// Customer Server Actions for dealer role group (T-04-06 / F-031 / docs/05 §4.7).
//
// Key difference from wholesaler variant:
//   - ownerRelationshipId is auto-set from ctx.relationshipIds[0].
//   - wholesalerId is resolved from ctx (the active wholesaler the dealer selected).
//
// PII masking is NOT applied here; read paths apply masking via DTO layer.

import { revalidatePath } from "next/cache";

import { CustomerCreateSchema } from "@solar/contracts";
import type { CustomerCreateInput } from "@solar/contracts";

import { ValidationError, NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

export interface CreateCustomerResult {
  id: string;
  duplicatePhoneWarning: boolean;
}

const LIST_PATH = "/d-customers";

export const createDealerCustomerAction = withServerActionContext<
  Omit<CustomerCreateInput, "ownerRelationshipId">,
  CreateCustomerResult
>(
  {
    action: "customer.create",
  },
  async ({ tx, ctx, input }) => {
    const relationshipId = ctx.relationshipIds[0];
    if (!relationshipId) {
      throw new ValidationError("有効な卸業者関係がありません");
    }

    // ctx.wholesalerId is only set when the dealer has explicitly selected a
    // wholesaler via the tenant switcher. Derive it from the relationship row
    // so single-wholesaler dealers (the common case) work without a switcher.
    const wholesalerId =
      ctx.wholesalerId ??
      (await tx.relationship.findFirst({
        where: { id: relationshipId },
        select: { wholesalerId: true },
      }).then((r) => r?.wholesalerId));

    if (!wholesalerId) {
      throw new ValidationError("卸業者コンテキストが必要です");
    }

    const merged: CustomerCreateInput = {
      ...(input as CustomerCreateInput),
      ownerRelationshipId: relationshipId,
    };
    const parsed = CustomerCreateSchema.parse(merged);

    const dupPhone = await tx.customer.findFirst({
      where: { wholesalerId, phone: parsed.phone },
      select: { id: true },
    });

    const created = await tx.customer.create({
      data: {
        wholesalerId,
        ownerRelationshipId: relationshipId,
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
        registeredByOrgType: "DEALER",
        registeredByRelationshipId: relationshipId,
        status: parsed.status,
        note: parsed.note ?? null,
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    return { id: created.id, duplicatePhoneWarning: !!dupPhone };
  },
);

interface UpdateDealerCustomerInput {
  id: string;
  name?: string;
  kana?: string;
  phone?: string;
  email?: string;
  postalCode?: string;
  address?: string;
  note?: string;
}

export const updateDealerCustomerAction = withServerActionContext<
  UpdateDealerCustomerInput,
  CreateCustomerResult
>(
  {
    action: "customer.update",
  },
  async ({ tx, input }) => {
    const existing = await tx.customer.findUnique({
      where: { id: input.id },
      select: { id: true, phone: true, wholesalerId: true },
    });
    if (!existing) {
      throw new NotFoundError("顧客が見つかりません");
    }

    let duplicatePhoneWarning = false;
    if (input.phone && input.phone !== existing.phone) {
      const dup = await tx.customer.findFirst({
        where: {
          wholesalerId: existing.wholesalerId,
          phone: input.phone,
          NOT: { id: input.id },
        },
        select: { id: true },
      });
      duplicatePhoneWarning = !!dup;
    }

    const updated = await tx.customer.update({
      where: { id: input.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kana !== undefined ? { kana: input.kana } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id, duplicatePhoneWarning };
  },
);
