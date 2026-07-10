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
  maekakuPreferredAt: string | null;
  maekakuCallNote: string | null;
  thankYouCallStatus: string | null;
  thankYouCallPreferredAt: string | null;
  thankYouCallNote: string | null;
  loanCompletionCallStatus: string | null;
  loanCompletionCallPreferredAt: string | null;
  loanCompletionCallNote: string | null;
  postCompletionCallStatus: string | null;
  postCompletionCallPreferredAt: string | null;
  postCompletionCallNote: string | null;
  generalCallPreferredTime: string | null;
}

export interface ProjectContractEditable {
  contractId: string;
  contractDate: string | null;
  equipmentSerialId: string | null;
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
  amount: number | null;
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
  plannedDate: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
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

// ローン審査（LoanReview）のインライン編集の生値（各審査）。履歴ログは表示 DTO 側に
// 持つ（追加/削除フォームは loanReviewId と customerId のみ要するため editable には不要）。
export interface ProjectLoanReviewEditable {
  loanReviewId: string;
  status: string;
  loanCompany: string | null;
  downPayment: number | null;
  creditLifeInsurance: boolean | null;
  note: string | null;
  reviewedAt: string | null;
}

export interface ProjectApplicationEditable {
  applicationId: string;
  contractId: string;
  status: string;
  type: string | null;
  submittedDate: string | null;
  approvedDate: string | null;
  grantedAmount: number | null;
  // 設置申請サブタブの表示名（ユーザー編集・業務ラベル）。null はデフォルト表記（申請#N）。
  tabLabel: string | null;
}

export interface ProjectInfoEditable {
  customerId: string;
  // 特記事項（契約タブのフリーテキストメモ）のインライン編集生値。
  specialNote: string | null;
  overview: ProjectOverviewEditable;
  hearing: ProjectHearingEditable;
  calls: ProjectCallsEditable;
  contracts: ProjectContractEditable[];
  // ローン審査（LoanReview）のインライン編集生値（createdAt 昇順＝#1/#2…）。
  loanReviews: ProjectLoanReviewEditable[];
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
        specialNote: true,
        electricBill: true,
        household: true,
        housingType: true,
        inflowRoute: true,
        maekakuStatus: true, // overview + calls 両セクションで参照
        maekakuPreferredAt: true,
        maekakuCallNote: true,
        husbandAge: true,
        wifeAge: true,
        childAge: true,
        guideAttendee: true,
        faceToFace: true,
        landlinePhone: true,
        mobilePhone: true,
        proposedProduct: true,
        thankYouCallStatus: true,
        thankYouCallPreferredAt: true,
        thankYouCallNote: true,
        postCompletionCallStatus: true,
        postCompletionCallPreferredAt: true,
        postCompletionCallNote: true,
        loanCompletionCallStatus: true,
        loanCompletionCallPreferredAt: true,
        loanCompletionCallNote: true,
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
        equipmentSerialId: true,
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
            amount: true,
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
            plannedDate: true,
            plannedStartDate: true,
            plannedEndDate: true,
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
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            status: true,
            type: true,
            submittedDate: true,
            approvedDate: true,
            grantedAmount: true,
            tabLabel: true,
          },
        },
      },
    });

    const loanReviewRows = await tx.loanReview.findMany({
      where: { customerId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        loanCompany: true,
        downPayment: true,
        creditLifeInsurance: true,
        note: true,
        reviewedAt: true,
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
        equipmentSerialId: c.equipmentSerialId,
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
        amount: decimalToNumber(e.amount),
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
          plannedDate: isoOrNull(con.plannedDate),
          plannedStartDate: isoOrNull(con.plannedStartDate),
          plannedEndDate: isoOrNull(con.plannedEndDate),
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
          tabLabel: a.tabLabel ?? null,
        });
      }
    }

    return {
      customerId: customer.id,
      specialNote: customer.specialNote,
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
        maekakuPreferredAt: isoOrNull(customer.maekakuPreferredAt),
        maekakuCallNote: customer.maekakuCallNote,
        thankYouCallStatus: customer.thankYouCallStatus,
        thankYouCallPreferredAt: isoOrNull(customer.thankYouCallPreferredAt),
        thankYouCallNote: customer.thankYouCallNote,
        loanCompletionCallStatus: customer.loanCompletionCallStatus,
        loanCompletionCallPreferredAt: isoOrNull(customer.loanCompletionCallPreferredAt),
        loanCompletionCallNote: customer.loanCompletionCallNote,
        postCompletionCallStatus: customer.postCompletionCallStatus,
        postCompletionCallPreferredAt: isoOrNull(customer.postCompletionCallPreferredAt),
        postCompletionCallNote: customer.postCompletionCallNote,
        generalCallPreferredTime: customer.generalCallPreferredTime,
      },
      contracts,
      loanReviews: loanReviewRows.map((r) => ({
        loanReviewId: r.id,
        status: r.status,
        loanCompany: r.loanCompany,
        downPayment: r.downPayment,
        creditLifeInsurance: r.creditLifeInsurance,
        note: r.note,
        reviewedAt: isoOrNull(r.reviewedAt),
      })),
      equipmentByContract,
      constructions,
      applications,
    };
  });
}
