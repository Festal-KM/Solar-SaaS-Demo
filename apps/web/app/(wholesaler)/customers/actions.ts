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

import {
  CustomerCreateSchema,
  CustomerHearingSchema,
  CustomerUpdateSchema,
} from "@solar/contracts";
import type {
  CustomerCreateInput,
  CustomerHearingInput,
  CustomerUpdateInput,
} from "@solar/contracts";

import { Prisma } from "@solar/db";

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
  async ({ tx, input }) => {
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
        ...(parsed.prefecture !== undefined ? { prefecture: parsed.prefecture?.trim() || null } : {}),
        ...(parsed.city !== undefined ? { city: parsed.city?.trim() || null } : {}),
        ...(parsed.addressLine !== undefined
          ? { addressLine: parsed.addressLine?.trim() || null }
          : {}),
        ...(parsed.birthDate !== undefined
          ? { birthDate: parsed.birthDate ? new Date(parsed.birthDate) : null }
          : {}),
        ...(parsed.buildYear !== undefined
          ? { buildYear: parsed.buildYear ? new Date(parsed.buildYear) : null }
          : {}),
        ...(parsed.tossDept !== undefined ? { tossDept: parsed.tossDept?.trim() || null } : {}),
        ...(parsed.belongDept !== undefined ? { belongDept: parsed.belongDept?.trim() || null } : {}),
        ...(parsed.electricContractStatus !== undefined
          ? { electricContractStatus: parsed.electricContractStatus?.trim() || null }
          : {}),
        ...(parsed.electricAccountNo !== undefined
          ? { electricAccountNo: parsed.electricAccountNo?.trim() || null }
          : {}),
        ...(parsed.supplyPointNo !== undefined
          ? { supplyPointNo: parsed.supplyPointNo?.trim() || null }
          : {}),
        ...(parsed.equipmentId !== undefined
          ? { equipmentId: parsed.equipmentId?.trim() || null }
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

// ---------------------------------------------------------------------------
// F-063 住環境・家族属性ヒアリング保存（docs/05 §17.9）.
//
// 顧客フォーム「住環境・家族ヒアリング」セクションの保存。Customer 拡張列を update、
// CustomerExistingEquipment を category 単位で upsert（@@unique([customerId, category])）、
// acquiredAt は代表アポへ反映。全クエリ withTenant + RLS の二重防御を通す。
// ---------------------------------------------------------------------------

export interface SaveCustomerHearingResult {
  id: string;
}

export const saveCustomerHearingAction = withServerActionContext<
  CustomerHearingInput,
  SaveCustomerHearingResult
>(
  {
    action: "customer.update",
  },
  async ({ tx, input }) => {
    const parsed = CustomerHearingSchema.parse(input);

    const existing = await tx.customer.findUnique({
      where: { id: parsed.customerId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("顧客が見つかりません");
    }

    await tx.customer.update({
      where: { id: parsed.customerId },
      data: {
        ...(parsed.landlinePhone !== undefined
          ? { landlinePhone: parsed.landlinePhone?.trim() || null }
          : {}),
        ...(parsed.mobilePhone !== undefined
          ? { mobilePhone: parsed.mobilePhone?.trim() || null }
          : {}),
        ...(parsed.husbandAge !== undefined ? { husbandAge: parsed.husbandAge } : {}),
        ...(parsed.wifeAge !== undefined ? { wifeAge: parsed.wifeAge } : {}),
        ...(parsed.childAge !== undefined ? { childAge: parsed.childAge } : {}),
        ...(parsed.household !== undefined ? { household: parsed.household?.trim() || null } : {}),
        ...(parsed.guideAttendee !== undefined ? { guideAttendee: parsed.guideAttendee } : {}),
        ...(parsed.faceToFace !== undefined ? { faceToFace: parsed.faceToFace } : {}),
        ...(parsed.proposedProduct !== undefined
          ? { proposedProduct: parsed.proposedProduct?.trim() || null }
          : {}),
        ...(parsed.proposedProductId !== undefined
          ? { proposedProductId: parsed.proposedProductId }
          : {}),
        ...(parsed.maekakuPreferredAt !== undefined
          ? {
              maekakuPreferredAt: parsed.maekakuPreferredAt
                ? new Date(parsed.maekakuPreferredAt)
                : null,
            }
          : {}),
      },
      select: { id: true },
    });

    for (const eq of parsed.existingEquipments) {
      // Prisma Json 入力は InputJsonValue のみ受ける（プレーン null は型不一致）。
      // null は JsonNull に丸めて DB 上 NULL にする。
      const attributes: Prisma.InputJsonValue | typeof Prisma.JsonNull =
        eq.attributes != null
          ? (eq.attributes as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      const common = {
        installed: eq.installed,
        installDate: eq.installDate ? new Date(eq.installDate) : null,
        maker: eq.maker?.trim() || null,
        capacityKw: eq.capacityKw != null ? eq.capacityKw.toString() : null,
        panelCount: eq.panelCount ?? null,
        attributes,
      };
      await tx.customerExistingEquipment.upsert({
        where: {
          customerId_category: { customerId: parsed.customerId, category: eq.category },
        },
        create: {
          customerId: parsed.customerId,
          category: eq.category,
          ...common,
        },
        update: common,
      });
    }

    // アポ取得日は代表アポ（最新 scheduledAt）へ反映。
    if (parsed.acquiredAt !== undefined) {
      const rep = await tx.appointment.findFirst({
        where: { customerId: parsed.customerId },
        orderBy: { scheduledAt: "desc" },
        select: { id: true },
      });
      if (rep) {
        await tx.appointment.update({
          where: { id: rep.id },
          data: { acquiredAt: parsed.acquiredAt ? new Date(parsed.acquiredAt) : null },
        });
      }
    }

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${parsed.customerId}`);
    return { id: parsed.customerId };
  },
);
