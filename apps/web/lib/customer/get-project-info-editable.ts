// F-062 案件情報インライン編集の「生値」ローダ。
//
// CustomerProjectInfo は表示用（マスク済み）DTO を受け取る。編集フォームの初期値には
// マスクされていない生値が要る（家族年齢は非 FULL ビューアで年代マスク、分離電話は
// 下4桁マスクされるため）。本ローダは customer.update 権限保持者のみに対し、PII を
// マスクせず編集対象の生値 + 各エンティティ ID を返す。二次店ロールでは null を返し、
// 編集 UI を一切出さない（呼び出し側が分岐）。
//
// 適用順（必須）: auth → assertCan('customer.update') → withTenant tx（RLS 二重防御）。
// Contract/Construction/Application/ContractEquipment/ContractPayment は親 Contract.
// wholesalerId 経由の相関 EXISTS で同一 RLS スコープ内。仕入値スナップショット
// （ContractItem.snapshot*）は select しない（読みも書きもしない／CLAUDE.md #4・#5）。

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function decimalToNumber(d: { toString(): string } | null | undefined): number | null {
  if (d == null) return null;
  const n = Number(d.toString());
  return Number.isNaN(n) ? null : n;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export interface ProjectOverviewEditable {
  electricBill: string | null;
  household: string | null;
  housingType: string | null;
  inflowRoute: string | null;
  maekakuStatus: string | null;
}

export interface ProjectHearingEditable {
  husbandAge: number | null;
  wifeAge: number | null;
  childAge: number | null;
  household: string | null;
  guideAttendee: string | null;
  faceToFace: boolean | null;
  landlinePhone: string | null;
  mobilePhone: string | null;
  proposedProduct: string | null;
}

export interface ProjectCallsEditable {
  maekakuStatus: string | null;
  maekakuPreferredPhone: string | null;
  postCompletionCallStatus: string | null;
  postCompletionCallPreferredAt: string | null;
  loanCompletionCallStatus: string | null;
  loanCompletionCallPreferredAt: string | null;
  generalCallPreferredTime: string | null;
}

export interface ProjectContractEditable {
  contractId: string;
  contractDate: string | null;
  contractAmount: number | null;
  equipmentSerialId: string | null;
  loanReviewCallAt: string | null;
  callStatus: string;
  paymentCount: number | null;
  paymentStatus: string | null;
  depositDate: string | null;
  dealerPayoutDate: string | null;
  loanCompany: string | null;
  downPayment: number | null;
  creditLifeInsurance: boolean | null;
  loanNote: string | null;
  loanReviewStatus: string | null;
}

export interface ProjectEquipmentEditable {
  id: string;
  contractId: string;
  category: string;
  contracted: boolean;
  manufacturer: string | null;
  model: string | null;
  capacity: string | null;
  quantity: number | null;
  installLocation: string | null;
  introducedStatus: string | null;
  warrantyStandard: boolean | null;
  warrantyExtended: boolean | null;
  warrantyDisaster: boolean | null;
  detail: string | null;
  attributes: Record<string, unknown> | null;
}

export interface ProjectConstructionEditable {
  constructionId: string;
  contractId: string;
  surveyDate: string | null;
  startedDate: string | null;
  completedDate: string | null;
  powerSaleStartDate: string | null;
  status: string;
  surveyStatus: string | null;
  vendorName: string | null;
  fee: number | null;
  // 親 Contract 由来（完工後ステータス・不備・サンキューコール）。
  postCompletionStatus: string;
  defectStatus: string;
  defectDetail: string | null;
  thankYouCallAt: string | null;
}

export interface ProjectApplicationEditable {
  applicationId: string;
  contractId: string;
  status: string;
  type: string | null;
  submittedDate: string | null;
  approvedDate: string | null;
  grantedAmount: number | null;
}

export interface ProjectInfoEditable {
  customerId: string;
  overview: ProjectOverviewEditable;
  hearing: ProjectHearingEditable;
  calls: ProjectCallsEditable;
  contracts: ProjectContractEditable[];
  // contractId → 設備明細（カテゴリ別の各行）。
  equipmentByContract: Record<string, ProjectEquipmentEditable[]>;
  constructions: ProjectConstructionEditable[];
  applications: ProjectApplicationEditable[];
}

/**
 * Returns the unmasked editable values for the F-062 inline edit forms, or
 * `null` when the viewer lacks `customer.update` (e.g. dealers / read-only
 * roles) — in which case the caller renders the read-only view without any edit
 * triggers. Throws `UnauthorizedError` when there is no session.
 */
export async function getCustomerProjectInfoEditable(
  customerId: string,
): Promise<ProjectInfoEditable | null> {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
    });
  }
  const ctx = await getTenantContext();
  // 仕入値は二次店に出さない（rule #5）。本ビューの編集は卸業者/SaaS のみ。
  if (ctx.dealerId && !ctx.isSaasAdmin) return null;
  // 二次店 / 編集権限なしは編集 UI を出さない（生値も渡さない）。assertCan は throw する
  // ので boolean に落とす（read-only ロールは編集トリガーを描画しないだけで詳細閲覧は可）。
  try {
    assertCan({
      user: {
        userId: ctx.actorUserId,
        roles: session.user.roles,
        isSaasAdmin: ctx.isSaasAdmin,
        tenantId: ctx.tenantId,
        wholesalerId: ctx.wholesalerId,
        dealerId: ctx.dealerId,
        relationshipIds: ctx.relationshipIds,
      },
      action: "customer.update",
    });
  } catch {
    return null;
  }

  return withTenant(ctx, async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        electricBill: true,
        household: true,
        housingType: true,
        inflowRoute: true,
        maekakuStatus: true, // overview + calls 両セクションで参照
        husbandAge: true,
        wifeAge: true,
        childAge: true,
        guideAttendee: true,
        faceToFace: true,
        landlinePhone: true,
        mobilePhone: true,
        proposedProduct: true,
        maekakuPreferredPhone: true,
        postCompletionCallStatus: true,
        postCompletionCallPreferredAt: true,
        loanCompletionCallStatus: true,
        loanCompletionCallPreferredAt: true,
        generalCallPreferredTime: true,
      },
    });
    if (!customer) return null;

    const contractRows = await tx.contract.findMany({
      where: { customerId },
      orderBy: { contractDate: "asc" },
      select: {
        id: true,
        contractDate: true,
        contractAmount: true,
        equipmentSerialId: true,
        loanReviewCallAt: true,
        callStatus: true,
        thankYouCallAt: true,
        postCompletionStatus: true,
        defectStatus: true,
        defectDetail: true,
        payment: {
          select: {
            paymentCount: true,
            paymentStatus: true,
            depositDate: true,
            dealerPayoutDate: true,
            loanCompany: true,
            downPayment: true,
            creditLifeInsurance: true,
            loanNote: true,
            loanReviewStatus: true,
          },
        },
        equipment: {
          orderBy: { category: "asc" },
          select: {
            id: true,
            category: true,
            contracted: true,
            manufacturer: true,
            model: true,
            capacity: true,
            quantity: true,
            installLocation: true,
            introducedStatus: true,
            warrantyStandard: true,
            warrantyExtended: true,
            warrantyDisaster: true,
            detail: true,
            attributes: true,
          },
        },
        constructions: {
          select: {
            id: true,
            surveyDate: true,
            startedDate: true,
            completedDate: true,
            powerSaleStartDate: true,
            status: true,
            surveyStatus: true,
            vendorName: true,
            fee: true,
          },
        },
        applications: {
          select: {
            id: true,
            status: true,
            type: true,
            submittedDate: true,
            approvedDate: true,
            grantedAmount: true,
          },
        },
      },
    });

    const contracts: ProjectContractEditable[] = [];
    const equipmentByContract: Record<string, ProjectEquipmentEditable[]> = {};
    const constructions: ProjectConstructionEditable[] = [];
    const applications: ProjectApplicationEditable[] = [];

    for (const c of contractRows) {
      contracts.push({
        contractId: c.id,
        contractDate: isoOrNull(c.contractDate),
        contractAmount: decimalToNumber(c.contractAmount),
        equipmentSerialId: c.equipmentSerialId,
        loanReviewCallAt: isoOrNull(c.loanReviewCallAt),
        callStatus: c.callStatus,
        paymentCount: c.payment?.paymentCount ?? null,
        paymentStatus: c.payment?.paymentStatus ?? null,
        depositDate: isoOrNull(c.payment?.depositDate),
        dealerPayoutDate: isoOrNull(c.payment?.dealerPayoutDate),
        loanCompany: c.payment?.loanCompany ?? null,
        downPayment: c.payment?.downPayment ?? null,
        creditLifeInsurance: c.payment?.creditLifeInsurance ?? null,
        loanNote: c.payment?.loanNote ?? null,
        loanReviewStatus: c.payment?.loanReviewStatus ?? null,
      });

      equipmentByContract[c.id] = c.equipment.map((e) => ({
        id: e.id,
        contractId: c.id,
        category: e.category,
        contracted: e.contracted,
        manufacturer: e.manufacturer,
        model: e.model,
        capacity: e.capacity,
        quantity: e.quantity,
        installLocation: e.installLocation,
        introducedStatus: e.introducedStatus,
        warrantyStandard: e.warrantyStandard,
        warrantyExtended: e.warrantyExtended,
        warrantyDisaster: e.warrantyDisaster,
        detail: e.detail,
        attributes: asRecord(e.attributes),
      }));

      for (const con of c.constructions) {
        constructions.push({
          constructionId: con.id,
          contractId: c.id,
          surveyDate: isoOrNull(con.surveyDate),
          startedDate: isoOrNull(con.startedDate),
          completedDate: isoOrNull(con.completedDate),
          powerSaleStartDate: isoOrNull(con.powerSaleStartDate),
          status: con.status,
          surveyStatus: con.surveyStatus,
          vendorName: con.vendorName,
          fee: decimalToNumber(con.fee),
          postCompletionStatus: c.postCompletionStatus,
          defectStatus: c.defectStatus,
          defectDetail: c.defectDetail,
          thankYouCallAt: isoOrNull(c.thankYouCallAt),
        });
      }

      for (const a of c.applications) {
        applications.push({
          applicationId: a.id,
          contractId: c.id,
          status: a.status,
          type: a.type,
          submittedDate: isoOrNull(a.submittedDate),
          approvedDate: isoOrNull(a.approvedDate),
          grantedAmount: decimalToNumber(a.grantedAmount),
        });
      }
    }

    return {
      customerId: customer.id,
      overview: {
        electricBill: customer.electricBill,
        household: customer.household,
        housingType: customer.housingType,
        inflowRoute: customer.inflowRoute,
        maekakuStatus: customer.maekakuStatus,
      },
      hearing: {
        husbandAge: customer.husbandAge,
        wifeAge: customer.wifeAge,
        childAge: customer.childAge,
        household: customer.household,
        guideAttendee: customer.guideAttendee,
        faceToFace: customer.faceToFace,
        landlinePhone: customer.landlinePhone,
        mobilePhone: customer.mobilePhone,
        proposedProduct: customer.proposedProduct,
      },
      calls: {
        maekakuStatus: customer.maekakuStatus,
        maekakuPreferredPhone: customer.maekakuPreferredPhone,
        postCompletionCallStatus: customer.postCompletionCallStatus,
        postCompletionCallPreferredAt: isoOrNull(customer.postCompletionCallPreferredAt),
        loanCompletionCallStatus: customer.loanCompletionCallStatus,
        loanCompletionCallPreferredAt: isoOrNull(customer.loanCompletionCallPreferredAt),
        generalCallPreferredTime: customer.generalCallPreferredTime,
      },
      contracts,
      equipmentByContract,
      constructions,
      applications,
    };
  });
}
