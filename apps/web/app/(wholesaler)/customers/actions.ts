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


import {
  buildDemoContractSeed,
  CustomerCreateSchema,
  CustomerHearingSchema,
  CustomerUpdateSchema,
  ProjectApplicationEditSchema,
  ProjectConstructionEditSchema,
  ProjectCallStatusSchema,
  ProjectContractEditSchema,
  ProjectContractEquipmentUpsertSchema,
  ProjectOverviewSchema,
  sumEquipmentAmounts,
} from "@solar/contracts";
import { Prisma } from "@solar/db";
import { revalidatePath } from "next/cache";

import { NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

import type {
  CustomerCreateInput,
  CustomerHearingInput,
  CustomerUpdateInput,
  ProjectApplicationEditInput,
  ProjectConstructionEditInput,
  ProjectCallStatusInput,
  ProjectContractEditInput,
  ProjectContractEquipmentUpsertInput,
  ProjectOverviewInput,
} from "@solar/contracts";

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
        ...(parsed.maekakuPreferredAt !== undefined
          ? { maekakuPreferredAt: parsed.maekakuPreferredAt ? new Date(parsed.maekakuPreferredAt) : null }
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

// ---------------------------------------------------------------------------
// F-062 案件情報インライン編集（docs/05 §16）.
//
// 顧客詳細「基本情報」タブの統合ビュー（CustomerProjectInfo）各セクションの保存。
// すべて auth → assertCan('customer.update') → withTenant tx の三段イディオム（RLS
// 二重防御）。Contract/Construction/Application/ContractEquipment/ContractPayment は
// 親 Contract.wholesalerId 経由の相関 EXISTS RLS スコープ内で更新する。各エンティティ
// が対象 customerId/contractId 配下であることを更新前に検証する（テナント越境防止）。
// 仕入値スナップショット（ContractItem.snapshotPurchasePrice 等）は読みも書きもしない。
// ---------------------------------------------------------------------------

function toDateOrNull(v: string | null | undefined): Date | null {
  return v ? new Date(v) : null;
}

export interface SaveProjectSectionResult {
  customerId: string;
}

// 概況（Customer 列）。
export const saveProjectOverviewAction = withServerActionContext<
  ProjectOverviewInput,
  SaveProjectSectionResult
>(
  { action: "customer.update" },
  async ({ tx, input }) => {
    const parsed = ProjectOverviewSchema.parse(input);

    const existing = await tx.customer.findUnique({
      where: { id: parsed.customerId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("顧客が見つかりません");

    await tx.customer.update({
      where: { id: parsed.customerId },
      data: {
        ...(parsed.electricBill !== undefined
          ? { electricBill: parsed.electricBill?.trim() || null }
          : {}),
        ...(parsed.household !== undefined ? { household: parsed.household?.trim() || null } : {}),
        ...(parsed.housingType !== undefined
          ? { housingType: parsed.housingType?.trim() || null }
          : {}),
        ...(parsed.inflowRoute !== undefined ? { inflowRoute: parsed.inflowRoute } : {}),
        ...(parsed.maekakuStatus !== undefined
          ? { maekakuStatus: parsed.maekakuStatus?.trim() || null }
          : {}),
      },
      select: { id: true },
    });

    revalidatePath(`${LIST_PATH}/${parsed.customerId}`);
    return { customerId: parsed.customerId };
  },
);

// コール状況（コールタブ 4 セクション・Customer 列）。マエカク/サンキュー/ローン審査完了/
// 施工完了コールのステータス + 希望日時 + メモ、汎用コール希望時間帯、マエカク希望電話。
// マエカク希望日時は商談履歴タブと共用列（last-write-wins）。三段イディオム（auth→customer.update→withTenant）。
export const saveProjectCallStatusAction = withServerActionContext<
  ProjectCallStatusInput,
  SaveProjectSectionResult
>(
  { action: "customer.update" },
  async ({ tx, input }) => {
    const parsed = ProjectCallStatusSchema.parse(input);

    const existing = await tx.customer.findUnique({
      where: { id: parsed.customerId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("顧客が見つかりません");

    await tx.customer.update({
      where: { id: parsed.customerId },
      data: {
        ...(parsed.maekakuStatus !== undefined ? { maekakuStatus: parsed.maekakuStatus } : {}),
        ...(parsed.maekakuPreferredAt !== undefined
          ? { maekakuPreferredAt: toDateOrNull(parsed.maekakuPreferredAt) }
          : {}),
        ...(parsed.maekakuCallNote !== undefined
          ? { maekakuCallNote: parsed.maekakuCallNote?.trim() || null }
          : {}),
        ...(parsed.maekakuPreferredPhone !== undefined
          ? { maekakuPreferredPhone: parsed.maekakuPreferredPhone?.trim() || null }
          : {}),
        ...(parsed.thankYouCallStatus !== undefined
          ? { thankYouCallStatus: parsed.thankYouCallStatus }
          : {}),
        ...(parsed.thankYouCallPreferredAt !== undefined
          ? { thankYouCallPreferredAt: toDateOrNull(parsed.thankYouCallPreferredAt) }
          : {}),
        ...(parsed.thankYouCallNote !== undefined
          ? { thankYouCallNote: parsed.thankYouCallNote?.trim() || null }
          : {}),
        ...(parsed.loanCompletionCallStatus !== undefined
          ? { loanCompletionCallStatus: parsed.loanCompletionCallStatus }
          : {}),
        ...(parsed.loanCompletionCallPreferredAt !== undefined
          ? { loanCompletionCallPreferredAt: toDateOrNull(parsed.loanCompletionCallPreferredAt) }
          : {}),
        ...(parsed.loanCompletionCallNote !== undefined
          ? { loanCompletionCallNote: parsed.loanCompletionCallNote?.trim() || null }
          : {}),
        ...(parsed.postCompletionCallStatus !== undefined
          ? { postCompletionCallStatus: parsed.postCompletionCallStatus }
          : {}),
        ...(parsed.postCompletionCallPreferredAt !== undefined
          ? { postCompletionCallPreferredAt: toDateOrNull(parsed.postCompletionCallPreferredAt) }
          : {}),
        ...(parsed.postCompletionCallNote !== undefined
          ? { postCompletionCallNote: parsed.postCompletionCallNote?.trim() || null }
          : {}),
        ...(parsed.generalCallPreferredTime !== undefined
          ? { generalCallPreferredTime: parsed.generalCallPreferredTime?.trim() || null }
          : {}),
      },
      select: { id: true },
    });

    revalidatePath(`${LIST_PATH}/${parsed.customerId}`);
    return { customerId: parsed.customerId };
  },
);

// 契約・金額・ローン（Contract + ContractPayment、1 契約単位）。
export const saveProjectContractAction = withServerActionContext<
  ProjectContractEditInput,
  SaveProjectSectionResult
>(
  { action: "customer.update" },
  async ({ tx, input }) => {
    const parsed = ProjectContractEditSchema.parse(input);

    // 対象 Contract が当該 customer 配下であることを RLS スコープ内で検証（越境防止）。
    const contract = await tx.contract.findFirst({
      where: { id: parsed.contractId, customerId: parsed.customerId },
      select: { id: true },
    });
    if (!contract) throw new NotFoundError("契約が見つかりません");

    await tx.contract.update({
      where: { id: parsed.contractId },
      data: {
        ...(parsed.contractDate !== undefined && parsed.contractDate
          ? { contractDate: new Date(parsed.contractDate) }
          : {}),
        ...(parsed.contractAmount !== undefined && parsed.contractAmount != null
          ? { contractAmount: parsed.contractAmount }
          : {}),
        ...(parsed.equipmentSerialId !== undefined
          ? { equipmentSerialId: parsed.equipmentSerialId?.trim() || null }
          : {}),
        ...(parsed.loanReviewCallAt !== undefined
          ? { loanReviewCallAt: toDateOrNull(parsed.loanReviewCallAt) }
          : {}),
        ...(parsed.callStatus !== undefined ? { callStatus: parsed.callStatus } : {}),
      },
      select: { id: true },
    });

    // ContractPayment は 1:1。未存在なら upsert で作成する。
    const paymentKeys = [
      parsed.paymentCount,
      parsed.paymentStatus,
      parsed.depositDate,
      parsed.dealerPayoutDate,
      parsed.loanCompany,
      parsed.downPayment,
      parsed.creditLifeInsurance,
      parsed.loanNote,
      parsed.loanReviewStatus,
    ];
    if (paymentKeys.some((v) => v !== undefined)) {
      const payData = {
        ...(parsed.paymentCount !== undefined ? { paymentCount: parsed.paymentCount } : {}),
        ...(parsed.paymentStatus !== undefined ? { paymentStatus: parsed.paymentStatus } : {}),
        ...(parsed.depositDate !== undefined
          ? { depositDate: toDateOrNull(parsed.depositDate) }
          : {}),
        ...(parsed.dealerPayoutDate !== undefined
          ? { dealerPayoutDate: toDateOrNull(parsed.dealerPayoutDate) }
          : {}),
        ...(parsed.loanCompany !== undefined
          ? { loanCompany: parsed.loanCompany?.trim() || null }
          : {}),
        ...(parsed.downPayment !== undefined ? { downPayment: parsed.downPayment } : {}),
        ...(parsed.creditLifeInsurance !== undefined
          ? { creditLifeInsurance: parsed.creditLifeInsurance }
          : {}),
        ...(parsed.loanNote !== undefined ? { loanNote: parsed.loanNote?.trim() || null } : {}),
        ...(parsed.loanReviewStatus !== undefined
          ? { loanReviewStatus: parsed.loanReviewStatus }
          : {}),
      };
      await tx.contractPayment.upsert({
        where: { contractId: parsed.contractId },
        create: { contractId: parsed.contractId, ...payData },
        update: payData,
      });
    }

    revalidatePath(`${LIST_PATH}/${parsed.customerId}`);
    return { customerId: parsed.customerId };
  },
);

// ---------------------------------------------------------------------------
// 契約状況タブ: 設備の追加・編集（契約 find-or-create 方式）.
//
// 契約が無い顧客でも PV/BT/付帯の設備・保証・契約金額を入力できるようにする。保存時に
// 顧客の契約が無ければ **デモ用の最小 Deal + Contract** を生成して紐づける（1 顧客 1
// 契約想定）。Contract/Deal の自動生成は本来クロージングフローの責務であり、ここでは
// 設備入力を成立させるためのデモ用途の最小生成である。GrossProfit / Incentive は
// 生成しない（損益・インセンティブ集計を汚さない）。仕入値スナップショット
// （ContractItem.snapshot*）も作らない（CLAUDE.md #4 / #5）。
//
// テナント整合: wholesalerId は ctx 由来、customerId 配下の Deal/Contract のみ操作する。
// 全クエリ withTenant + RLS の二重防御を通す。設備は contractId × category で代表 1 行を
// find-or-create（同カテゴリ複数行は MVP では作らない）。
// ---------------------------------------------------------------------------
export const saveProjectContractEquipmentAction = withServerActionContext<
  ProjectContractEquipmentUpsertInput,
  SaveProjectSectionResult & { contractId: string }
>(
  { action: "customer.update" },
  async ({ tx, ctx, input }) => {
    const parsed = ProjectContractEquipmentUpsertSchema.parse(input);

    const customer = await tx.customer.findUnique({
      where: { id: parsed.customerId },
      select: { id: true, wholesalerId: true, ownerRelationshipId: true },
    });
    if (!customer) throw new NotFoundError("顧客が見つかりません");

    // 契約 find-or-create。contractId 指定時はそれを当該 customer 配下で検証して使う。
    let contractId: string | null = null;
    if (parsed.contractId) {
      const found = await tx.contract.findFirst({
        where: { id: parsed.contractId, customerId: parsed.customerId },
        select: { id: true },
      });
      if (!found) throw new NotFoundError("契約が見つかりません");
      contractId = found.id;
    } else {
      const existing = await tx.contract.findFirst({
        where: { customerId: parsed.customerId },
        orderBy: { contractDate: "asc" },
        select: { id: true },
      });
      contractId = existing?.id ?? null;
    }

    // 契約が無ければデモ用の最小 Deal + Contract を生成（GrossProfit/Incentive は作らない）。
    if (!contractId) {
      const settings = await tx.wholesalerSettings.findUnique({
        where: { wholesalerId: customer.wholesalerId },
        select: { cancelDeadlineDays: true },
      });
      const seed = buildDemoContractSeed({
        contractAmount: parsed.contractAmount ?? null,
        hasBattery: parsed.category === "BT",
        cancelDeadlineDays: settings?.cancelDeadlineDays,
      });
      // ownerType は登録主体に合わせる（二次店配下なら DEALER）。
      const ownerType = ctx.dealerId ? "DEALER" : "WHOLESALER";
      const deal = await tx.deal.create({
        data: {
          customerId: parsed.customerId,
          ownerType,
          ownerUserId: ctx.actorUserId,
          ownerRelationshipId: customer.ownerRelationshipId,
          status: seed.dealStatus,
        },
        select: { id: true },
      });
      const contract = await tx.contract.create({
        data: {
          wholesalerId: customer.wholesalerId,
          dealId: deal.id,
          customerId: parsed.customerId,
          ownerRelationshipId: customer.ownerRelationshipId,
          contractDate: seed.contractDate,
          contractAmount: seed.contractAmount,
          cancelDeadline: seed.cancelDeadline,
          hasBattery: seed.hasBattery,
          status: seed.status,
          createdBy: ctx.actorUserId,
        },
        select: { id: true },
      });
      contractId = contract.id;
    } else if (parsed.contractAmount != null) {
      // 既存契約に対して契約金額の指定があれば反映（Contract.contractAmount を正とする）。
      await tx.contract.update({
        where: { id: contractId },
        data: { contractAmount: parsed.contractAmount },
        select: { id: true },
      });
    }

    const attributes:
      | Prisma.InputJsonValue
      | typeof Prisma.JsonNull
      | undefined =
      parsed.attributes === undefined
        ? undefined
        : parsed.attributes != null
          ? (parsed.attributes as Prisma.InputJsonValue)
          : Prisma.JsonNull;

    // 設備は contractId × category の代表 1 行を find-or-create（同カテゴリ複数は作らない）。
    const existingEq = await tx.contractEquipment.findFirst({
      where: { contractId, category: parsed.category },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    const writable = {
      ...(parsed.contracted !== undefined ? { contracted: parsed.contracted } : {}),
      // 商材ごとの契約金額（顧客向け・原価ではない）。null でクリア。
      ...(parsed.amount !== undefined ? { amount: parsed.amount } : {}),
      ...(parsed.manufacturer !== undefined
        ? { manufacturer: parsed.manufacturer?.trim() || null }
        : {}),
      ...(parsed.model !== undefined ? { model: parsed.model?.trim() || null } : {}),
      ...(parsed.capacity !== undefined ? { capacity: parsed.capacity?.trim() || null } : {}),
      ...(parsed.quantity !== undefined ? { quantity: parsed.quantity } : {}),
      ...(parsed.installLocation !== undefined
        ? { installLocation: parsed.installLocation?.trim() || null }
        : {}),
      ...(parsed.introducedStatus !== undefined
        ? { introducedStatus: parsed.introducedStatus }
        : {}),
      ...(parsed.warrantyStandard !== undefined
        ? { warrantyStandard: parsed.warrantyStandard }
        : {}),
      ...(parsed.warrantyExtended !== undefined
        ? { warrantyExtended: parsed.warrantyExtended }
        : {}),
      ...(parsed.warrantyDisaster !== undefined
        ? { warrantyDisaster: parsed.warrantyDisaster }
        : {}),
      ...(parsed.detail !== undefined ? { detail: parsed.detail?.trim() || null } : {}),
      ...(attributes !== undefined ? { attributes } : {}),
    };

    if (existingEq) {
      await tx.contractEquipment.update({
        where: { id: existingEq.id },
        data: writable,
        select: { id: true },
      });
    } else {
      await tx.contractEquipment.create({
        data: {
          contractId,
          category: parsed.category,
          // 新規追加時は明示指定が無ければ「契約あり」を既定とする（追加導線の意図）。
          contracted: parsed.contracted ?? true,
          ...writable,
        },
        select: { id: true },
      });
    }

    // 契約合計（Contract.contractAmount）= 各商材 amount の合計を反映（UI 整合）。
    // 明示的な contractAmount 指定が無いときのみ、商材金額から導出する。全商材 null の
    // ときは合計を更新しない（既存の契約金額を温存）。GrossProfit/Incentive は触らない。
    if (parsed.contractAmount == null) {
      const lines = await tx.contractEquipment.findMany({
        where: { contractId },
        select: { amount: true },
      });
      const total = sumEquipmentAmounts(
        lines.map((l) => (l.amount != null ? Number(l.amount.toString()) : null)),
      );
      if (total != null) {
        await tx.contract.update({
          where: { id: contractId },
          data: { contractAmount: total },
          select: { id: true },
        });
      }
    }

    revalidatePath(`${LIST_PATH}/${parsed.customerId}`);
    return { customerId: parsed.customerId, contractId };
  },
);

// 工事・完工（Construction + 親 Contract の完工後/不備/サンキューコール列）。
export const saveProjectConstructionAction = withServerActionContext<
  ProjectConstructionEditInput,
  SaveProjectSectionResult
>(
  { action: "customer.update" },
  async ({ tx, input }) => {
    const parsed = ProjectConstructionEditSchema.parse(input);

    const con = await tx.construction.findFirst({
      where: {
        id: parsed.constructionId,
        contractId: parsed.contractId,
        contract: { customerId: parsed.customerId },
      },
      select: { id: true },
    });
    if (!con) throw new NotFoundError("施工情報が見つかりません");

    await tx.construction.update({
      where: { id: parsed.constructionId },
      data: {
        ...(parsed.surveyDate !== undefined ? { surveyDate: toDateOrNull(parsed.surveyDate) } : {}),
        ...(parsed.startedDate !== undefined
          ? { startedDate: toDateOrNull(parsed.startedDate) }
          : {}),
        ...(parsed.completedDate !== undefined
          ? { completedDate: toDateOrNull(parsed.completedDate) }
          : {}),
        ...(parsed.powerSaleStartDate !== undefined
          ? { powerSaleStartDate: toDateOrNull(parsed.powerSaleStartDate) }
          : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed.surveyStatus !== undefined ? { surveyStatus: parsed.surveyStatus } : {}),
        ...(parsed.vendorName !== undefined
          ? { vendorName: parsed.vendorName?.trim() || null }
          : {}),
        ...(parsed.fee !== undefined ? { fee: parsed.fee } : {}),
      },
      select: { id: true },
    });

    // 完工後ステータス・不備・サンキューコールは親 Contract が source of truth（§16.2）。
    const contractKeys = [
      parsed.postCompletionStatus,
      parsed.defectStatus,
      parsed.defectDetail,
      parsed.thankYouCallAt,
    ];
    if (contractKeys.some((v) => v !== undefined)) {
      await tx.contract.update({
        where: { id: parsed.contractId },
        data: {
          ...(parsed.postCompletionStatus !== undefined
            ? { postCompletionStatus: parsed.postCompletionStatus }
            : {}),
          ...(parsed.defectStatus !== undefined ? { defectStatus: parsed.defectStatus } : {}),
          ...(parsed.defectDetail !== undefined
            ? { defectDetail: parsed.defectDetail?.trim() || null }
            : {}),
          ...(parsed.thankYouCallAt !== undefined
            ? { thankYouCallAt: toDateOrNull(parsed.thankYouCallAt) }
            : {}),
        },
        select: { id: true },
      });
    }

    revalidatePath(`${LIST_PATH}/${parsed.customerId}`);
    return { customerId: parsed.customerId };
  },
);

// 認定・設備（申請）（Application）。
export const saveProjectApplicationAction = withServerActionContext<
  ProjectApplicationEditInput,
  SaveProjectSectionResult
>(
  { action: "customer.update" },
  async ({ tx, input }) => {
    const parsed = ProjectApplicationEditSchema.parse(input);

    const app = await tx.application.findFirst({
      where: {
        id: parsed.applicationId,
        contractId: parsed.contractId,
        contract: { customerId: parsed.customerId },
      },
      select: { id: true },
    });
    if (!app) throw new NotFoundError("申請情報が見つかりません");

    await tx.application.update({
      where: { id: parsed.applicationId },
      data: {
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        // type は DB 上 NOT NULL。空文字クリア時は既存維持のためスキップする。
        ...(parsed.type !== undefined && parsed.type && parsed.type.trim()
          ? { type: parsed.type.trim() }
          : {}),
        ...(parsed.submittedDate !== undefined
          ? { submittedDate: toDateOrNull(parsed.submittedDate) }
          : {}),
        ...(parsed.approvedDate !== undefined
          ? { approvedDate: toDateOrNull(parsed.approvedDate) }
          : {}),
        ...(parsed.grantedAmount !== undefined ? { grantedAmount: parsed.grantedAmount } : {}),
      },
      select: { id: true },
    });

    revalidatePath(`${LIST_PATH}/${parsed.customerId}`);
    return { customerId: parsed.customerId };
  },
);
