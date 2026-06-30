// F-061「顧客詳細 案件情報 統合ビュー」集約読み取りローダ（docs/05 §16.10）。
//
// 責務: Customer を起点に正テーブル（Deal / Contract / ContractItem /
// GrossProfit / Construction / Application / ContractPayment /
// ContractEquipment / CustomerActivity）を横断結合して **読むだけ**。書かない。
//
// 適用順（必須）:
//   1. withTenant(ctx, ...) で RLS/extension の二重防御を確立（最外）。
//   2. DealerScopeService 相当の二次店スコープ判定 → ViewerContext 構築。
//   3. DTO 整形時に MaskingService を適用（maskName/maskPhone/maskAddress/maskBirthDate）。
//   4. 二次店ロールでは原価系フィールドを destructure-and-rest で物理除去
//      （DEALER_OMITTED_FINANCIAL_KEYS、Object.keys に出さない／#5）。

import "server-only";

import {
  emptyEquipmentByCategory,
  pickRepresentativeConstruction,
  toProjectInfoDealerDto,
  toProjectInfoWholesalerDto,
} from "@solar/contracts/dto/project-info";
import {
  computeAge,
  isFullPiiViewer,
  maskAddress,
  maskBirthDate,
  maskFamilyAge,
  maskLandlinePhone,
  maskMobilePhone,
  maskName,
  maskPhone,
} from "@solar/contracts/services/masking";
import { presignDownload } from "@solar/storage";

import { auth } from "@/auth";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { TxClient } from "@/lib/tenancy/with-tenant";
import type {
  EquipmentByCategory,
  EquipmentCategoryKey,
  EquipmentItemDto,
  ProjectInfoDto,
  ProjectInfoForDealerDto,
} from "@solar/contracts/dto/project-info";
import type { ViewerContext } from "@solar/contracts/services/masking";
import type { TenantContext } from "@solar/db";

function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// Prisma Decimal → number（null 透過）。Decimal は toString/Number で安全に数値化。
function decimalToNumber(d: { toString(): string } | null | undefined): number | null {
  if (d == null) return null;
  const n = Number(d.toString());
  return Number.isNaN(n) ? null : n;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// 契約書一式URL: R2 fileKey を 15 分 pre-signed URL に解決（§9）。無ければ外部 docsUrl。
async function resolveDocsUrl(fileKey: string | null, docsUrl: string | null): Promise<string | null> {
  if (fileKey) {
    try {
      const { getUrl } = await presignDownload({ key: fileKey });
      return getUrl;
    } catch {
      // pre-sign 失敗時は外部 URL にフォールバック（閲覧を壊さない）。
    }
  }
  return docsUrl;
}

/**
 * Documented core (docs/05 §16.10). Reads the aggregate under an already-active
 * `withTenant` scope and shapes the full (wholesaler-grade) `ProjectInfoDto`.
 * PII is masked per `viewer`. Cost stripping for dealers happens in the
 * page-level wrapper via `toProjectInfoDealerDto`.
 *
 * Throws `NotFoundError` when the customer is out of the tenant scope (RLS 0 件).
 */
export async function getProjectInfo(
  ctx: TenantContext,
  customerId: string,
  viewer: ViewerContext,
): Promise<ProjectInfoDto> {
  return withTenant(ctx, (tx) => loadProjectInfo(tx, customerId, viewer));
}

async function loadProjectInfo(
  tx: TxClient,
  customerId: string,
  viewer: ViewerContext,
): Promise<ProjectInfoDto> {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      kana: true,
      phone: true,
      email: true,
      postalCode: true,
      address: true,
      prefecture: true,
      city: true,
      addressLine: true,
      birthDate: true,
      buildYear: true,
      tossDept: true,
      belongDept: true,
      housingType: true,
      electricBill: true,
      household: true,
      inflowRoute: true,
      maekakuStatus: true,
      note: true,
      specialNote: true,
      tossUpUserId: true,
      tossUpRelationshipId: true,
      closingUserId: true,
      closingRelationshipId: true,
      // 次回アポ（商談タブ編集・コールタブ read-only 表示）。
      nextAppointmentAt: true,
      nextAction: true,
      nextAppointmentAssigneeUserId: true,
      // F-063 ヒアリング（住環境・家族）。マスキング/二次店物理除外は DTO 整形時に適用。
      landlinePhone: true,
      mobilePhone: true,
      husbandAge: true,
      wifeAge: true,
      childAge: true,
      guideAttendee: true,
      faceToFace: true,
      proposedProduct: true,
      maekakuPreferredAt: true,
      // コール状況（コールタブ 4 セクション）。マエカク希望電話は maskPhone で DTO 整形時にマスク。
      maekakuCallNote: true,
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
      // 過去コール履歴（CustomerCallLog・画面追加・架電日時/対応者/メモ）。calledAt 降順。
      callLogs: {
        orderBy: { calledAt: "desc" },
        select: { id: true, calledAt: true, handlerUserId: true, note: true },
      },
      // ローン審査（LoanReview・顧客 1:N・サブタブ）。createdAt 昇順（#1/#2…の順）。
      // 各審査の履歴ログ（LoanReviewLog）は reviewedAt 降順。
      loanReviews: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          loanCompany: true,
          downPayment: true,
          creditLifeInsurance: true,
          note: true,
          reviewedAt: true,
          logs: {
            orderBy: { reviewedAt: "desc" },
            select: {
              id: true,
              reviewedAt: true,
              result: true,
              note: true,
              defectContent: true,
              defectResolved: true,
              assigneeUserId: true,
              createdByUserId: true,
            },
          },
        },
      },
      existingEquipments: {
        orderBy: { category: "asc" },
        select: {
          id: true,
          category: true,
          installed: true,
          installDate: true,
          maker: true,
          capacityKw: true,
          panelCount: true,
          attributes: true,
        },
      },
      // アポ獲得日（代表アポ）を導出するための最小選択。
      appointments: {
        orderBy: { scheduledAt: "desc" },
        select: {
          acquiredAt: true,
          scheduledAt: true,
        },
      },
    },
  });
  if (!customer) {
    throw new NotFoundError("Customer not found in tenant scope");
  }

  const full = isFullPiiViewer(viewer);

  const [deals, activityRows] = await Promise.all([
    tx.deal.findMany({
      where: { customerId },
      select: { id: true, proposedAmount: true },
    }),
    tx.customerActivity.findMany({
      where: { customerId },
      orderBy: { occurredAt: "desc" },
      select: { id: true, occurredAt: true, category: true, detail: true, amount: true },
    }),
  ]);
  const proposedByDealId = new Map(deals.map((d) => [d.id, decimalToNumber(d.proposedAmount)]));

  // 各 Deal 配下の Contract（1:1）。新規子テーブル（payment/equipment）は親
  // Contract.wholesalerId 経由の相関 EXISTS（§16.4）で同一 RLS スコープ内。
  const contractRows = await tx.contract.findMany({
    where: { customerId },
    orderBy: { contractDate: "asc" },
    select: {
      id: true,
      dealId: true,
      contractDate: true,
      contractAmount: true,
      fileKey: true,
      docsUrl: true,
      equipmentSerialId: true,
      loanReviewCallAt: true,
      callStatus: true,
      // 完工後・不備・サンキューコールは Contract が source of truth（§16.2）。
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
          contractItem: { select: { snapshotPurchasePrice: true } },
        },
      },
      constructions: {
        select: {
          id: true,
          surveyDate: true,
          plannedDate: true,
          startedDate: true,
          completedDate: true,
          powerSaleStartDate: true,
          surveyCandidates: true,
          constructionCandidates: true,
          status: true,
          surveyStatus: true,
          vendorName: true,
          fee: true,
          installer: { select: { name: true } },
          updatedAt: true,
          createdAt: true,
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
      grossProfit: {
        select: {
          salesPrice: true,
          purchaseTotal: true,
          dealerTotal: true,
          constructionFee: true,
          otherCost: true,
          discount: true,
          projectProfit: true,
          wholesaleProfit: true,
          profitRate: true,
          incentiveTargetProfit: true,
        },
      },
      incentives: { select: { amount: true } },
    },
  });

  // 担当者名（自社社員 User / 二次店 Relationship→dealer）の解決。
  const userIds = [
    ...new Set(
      [
        customer.tossUpUserId,
        customer.closingUserId,
        customer.nextAppointmentAssigneeUserId,
        ...customer.callLogs.map((l) => l.handlerUserId),
        ...customer.loanReviews.flatMap((r) => r.logs.map((l) => l.createdByUserId)),
        ...customer.loanReviews.flatMap((r) =>
          r.logs.map((l) => l.assigneeUserId).filter((v): v is string => !!v),
        ),
      ].filter((v): v is string => !!v),
    ),
  ];
  const relIds = [
    ...new Set(
      [customer.tossUpRelationshipId, customer.closingRelationshipId].filter(
        (v): v is string => !!v,
      ),
    ),
  ];
  const [userRows, relRows] = await Promise.all([
    userIds.length > 0
      ? tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
    relIds.length > 0
      ? tx.relationship.findMany({
          where: { id: { in: relIds } },
          select: { id: true, dealer: { select: { name: true } } },
        })
      : Promise.resolve([] as { id: string; dealer: { name: string } }[]),
  ]);
  const nameByUserId = new Map(userRows.map((u) => [u.id, u.name]));
  const dealerNameByRelId = new Map(relRows.map((r) => [r.id, r.dealer.name]));

  function resolveAssigneeName(userId: string | null, relationshipId: string | null): string | null {
    if (relationshipId) return dealerNameByRelId.get(relationshipId) ?? null;
    if (userId) return nameByUserId.get(userId) ?? null;
    return null;
  }

  // 設備行を category 別に振り分け（カテゴリ 7）。仕入値は wholesaler/saas のみ含める。
  function bucketEquipment(
    rows: (typeof contractRows)[number]["equipment"],
  ): EquipmentByCategory {
    const buckets = emptyEquipmentByCategory();
    for (const e of rows) {
      const item: EquipmentItemDto = {
        id: e.id,
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
        snapshotPurchasePrice: decimalToNumber(e.contractItem?.snapshotPurchasePrice ?? null),
      };
      buckets[e.category as EquipmentCategoryKey].push(item);
    }
    return buckets;
  }

  // カテゴリ 5: 全 Construction 行を保持しつつ、契約ごとに代表 1 件を選定（§16.2）。
  const constructions: ProjectInfoDto["constructions"] = [];
  const contracts: ProjectInfoDto["contracts"] = [];
  // 損益計算（GrossProfit 1:1）。未計算契約は配列に含めない（UI が空状態）。
  const profitAndLoss: ProjectInfoDto["profitAndLoss"] = [];

  // 金額サマリ（contracts 全体の合計／代表値）。
  let purchaseTotal = 0;
  let dealerTotal = 0;
  let constructionFee = 0;
  let otherCost = 0;
  let incentiveGrossProfit: number | null = null;
  let incentiveAmount: number | null = null;
  let contractAmountSummary: number | null = null;
  let proposedAmountSummary: number | null = null;

  for (const c of contractRows) {
    for (const con of c.constructions) {
      constructions.push({
        constructionId: con.id,
        contractId: c.id,
        surveyDate: isoOrNull(con.surveyDate),
        surveyCandidates: con.surveyCandidates ?? null,
        constructionCandidates: con.constructionCandidates ?? null,
        startedDate: isoOrNull(con.startedDate),
        completedDate: isoOrNull(con.completedDate),
        powerSaleStartDate: isoOrNull(con.powerSaleStartDate),
        status: con.status,
        surveyStatus: con.surveyStatus,
        // 完工後・不備・サンキューコールは親 Contract から伝播（§16.2）。
        postCompletionStatus: c.postCompletionStatus,
        defectStatus: c.defectStatus,
        defectDetail: c.defectDetail,
        vendorName: con.installer?.name ?? con.vendorName ?? null,
        thankYouCallAt: isoOrNull(c.thankYouCallAt),
        fee: decimalToNumber(con.fee),
      });
    }

    const rep = pickRepresentativeConstruction(c.constructions);
    const docsUrl = await resolveDocsUrl(c.fileKey, c.docsUrl);
    const proposed = proposedByDealId.get(c.dealId) ?? null;
    const amount = decimalToNumber(c.contractAmount);

    contracts.push({
      contractId: c.id,
      contractDate: isoOrNull(c.contractDate),
      docsUrl,
      proposedAmount: proposed,
      contractAmount: amount,
      paymentCount: c.payment?.paymentCount ?? null,
      paymentStatus: c.payment?.paymentStatus ?? null,
      depositDate: isoOrNull(c.payment?.depositDate),
      dealerPayoutDate: isoOrNull(c.payment?.dealerPayoutDate),
      loanReviewCallAt: isoOrNull(c.loanReviewCallAt),
      loanCompany: c.payment?.loanCompany ?? null,
      downPayment: c.payment?.downPayment ?? null,
      creditLifeInsurance: c.payment?.creditLifeInsurance ?? null,
      loanNote: c.payment?.loanNote ?? null,
      loanReviewStatus: c.payment?.loanReviewStatus ?? null,
      callStatus: c.callStatus,
      equipmentSerialId: c.equipmentSerialId,
      representativeConstructionId: rep?.id ?? null,
      equipment: bucketEquipment(c.equipment),
    });

    if (c.grossProfit) {
      const gp = c.grossProfit;
      purchaseTotal += decimalToNumber(gp.purchaseTotal) ?? 0;
      dealerTotal += decimalToNumber(gp.dealerTotal) ?? 0;
      constructionFee += decimalToNumber(gp.constructionFee) ?? 0;
      otherCost += decimalToNumber(gp.otherCost) ?? 0;
      const igp = decimalToNumber(gp.incentiveTargetProfit);
      if (igp != null) incentiveGrossProfit = (incentiveGrossProfit ?? 0) + igp;

      profitAndLoss.push({
        contractId: c.id,
        contractDate: isoOrNull(c.contractDate),
        salesPrice: decimalToNumber(gp.salesPrice) ?? 0,
        purchaseTotal: decimalToNumber(gp.purchaseTotal) ?? 0,
        dealerTotal: decimalToNumber(gp.dealerTotal) ?? 0,
        constructionFee: decimalToNumber(gp.constructionFee) ?? 0,
        otherCost: decimalToNumber(gp.otherCost) ?? 0,
        discount: decimalToNumber(gp.discount) ?? 0,
        projectProfit: decimalToNumber(gp.projectProfit) ?? 0,
        wholesaleProfit: decimalToNumber(gp.wholesaleProfit) ?? 0,
        profitRate: decimalToNumber(gp.profitRate) ?? 0,
      });
    }
    for (const inc of c.incentives) {
      const a = decimalToNumber(inc.amount);
      if (a != null) incentiveAmount = (incentiveAmount ?? 0) + a;
    }
    if (amount != null) contractAmountSummary = (contractAmountSummary ?? 0) + amount;
    if (proposed != null) proposedAmountSummary = (proposedAmountSummary ?? 0) + proposed;
  }

  const applications: ProjectInfoDto["applications"] = contractRows.flatMap((c) =>
    c.applications.map((a) => ({
      applicationId: a.id,
      status: a.status,
      type: a.type,
      submittedDate: isoOrNull(a.submittedDate),
      approvedDate: isoOrNull(a.approvedDate),
      grantedAmount: decimalToNumber(a.grantedAmount),
    })),
  );

  const dto: ProjectInfoDto = {
    basic: {
      customerId: customer.id,
      name: maskName(customer.name, viewer),
      kana: customer.kana,
      birthDate: maskBirthDate(customer.birthDate, viewer),
      age: full ? computeAge(customer.birthDate) : null,
      postalCode: customer.postalCode,
      address: customer.address ? maskAddress(customer.address, viewer) : "未設定",
      phone: maskPhone(customer.phone, viewer),
      email: customer.email,
      buildYear: isoOrNull(customer.buildYear),
    },
    organization: {
      tossUpUserName: resolveAssigneeName(customer.tossUpUserId, customer.tossUpRelationshipId),
      closingUserName: resolveAssigneeName(customer.closingUserId, customer.closingRelationshipId),
      tossDept: customer.tossDept,
      belongDept: customer.belongDept,
    },
    contracts,
    loanReviews: customer.loanReviews.map((r) => ({
      loanReviewId: r.id,
      status: r.status,
      loanCompany: r.loanCompany,
      downPayment: r.downPayment,
      creditLifeInsurance: r.creditLifeInsurance,
      note: r.note,
      reviewedAt: isoOrNull(r.reviewedAt),
      logs: r.logs.map((l) => ({
        id: l.id,
        reviewedAt: l.reviewedAt.toISOString(),
        result: l.result,
        note: l.note,
        defectContent: l.defectContent,
        defectResolved: l.defectResolved,
        assigneeUserId: l.assigneeUserId,
        assigneeName: l.assigneeUserId ? nameByUserId.get(l.assigneeUserId) ?? null : null,
        handlerName: nameByUserId.get(l.createdByUserId) ?? null,
      })),
    })),
    constructions,
    applications,
    activities: activityRows.map((a) => ({
      activityId: a.id,
      category: a.category,
      amount: a.amount ?? null,
      occurredAt: a.occurredAt.toISOString(),
      body: a.detail,
    })),
    note: customer.note,
    specialNote: customer.specialNote,
    overview: {
      electricBill: customer.electricBill,
      household: customer.household,
      housingType: customer.housingType,
      inflowRoute: customer.inflowRoute,
      maekakuStatus: customer.maekakuStatus,
    },
    financials: {
      contractAmount: contractAmountSummary,
      proposedAmount: proposedAmountSummary,
      incentiveGrossProfit,
      incentiveAmount,
      purchaseTotal,
      dealerTotal,
      constructionFee,
      otherCost,
    },
    profitAndLoss,
    // F-063 ヒアリング（住環境・家族）。家族年齢/分離電話は MaskingService 適用済。
    // 既設設備の詳細キーは二次店ロールで toProjectInfoDealerDto が物理除外する（§17.5）。
    hearing: {
      husbandAge: maskFamilyAge(customer.husbandAge, viewer),
      wifeAge: maskFamilyAge(customer.wifeAge, viewer),
      childAge: maskFamilyAge(customer.childAge, viewer),
      household: customer.household,
      guideAttendee: customer.guideAttendee,
      faceToFace: customer.faceToFace,
      proposedProduct: customer.proposedProduct,
      landlinePhone: maskLandlinePhone(customer.landlinePhone, viewer),
      mobilePhone: maskMobilePhone(customer.mobilePhone, viewer),
      maekakuPreferredAt: isoOrNull(customer.maekakuPreferredAt),
      acquiredAt: isoOrNull(
        customer.appointments
          .map((a) => a.acquiredAt)
          .filter((d): d is Date => d != null)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      ),
      existingEquipments: customer.existingEquipments.map((eq) => ({
        id: eq.id,
        category: eq.category,
        installed: eq.installed,
        installDate: isoOrNull(eq.installDate),
        maker: eq.maker,
        capacityKw: decimalToNumber(eq.capacityKw),
        panelCount: eq.panelCount,
        attributes: asRecord(eq.attributes),
      })),
    },
    // コールタブ。固定電話/携帯電話は連絡先 PII（maskLandlinePhone/maskMobilePhone で下4桁
    // マスク）でタブ上部に表示。マエカク希望日時は商談履歴タブと共用列。callLogs は画面から
    // 追加する過去コール履歴（架電日時/対応者/メモ）。次回アポは商談タブ編集値の read-only。
    calls: {
      landlinePhone: maskLandlinePhone(customer.landlinePhone, viewer),
      mobilePhone: maskMobilePhone(customer.mobilePhone, viewer),
      maekakuStatus: customer.maekakuStatus,
      maekakuPreferredAt: isoOrNull(customer.maekakuPreferredAt),
      maekakuCallNote: customer.maekakuCallNote,
      nextAppointmentAt: isoOrNull(customer.nextAppointmentAt),
      nextAppointmentAssigneeName: customer.nextAppointmentAssigneeUserId
        ? nameByUserId.get(customer.nextAppointmentAssigneeUserId) ?? null
        : null,
      nextAction: customer.nextAction,
      callLogs: customer.callLogs.map((l) => ({
        id: l.id,
        calledAt: l.calledAt.toISOString(),
        handlerName: l.handlerUserId ? nameByUserId.get(l.handlerUserId) ?? null : null,
        note: l.note,
      })),
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
  };

  return dto;
}

/**
 * Page-level entry for the F-061 view. Self-contained auth → assertCan →
 * withTenant (mirrors `getCustomerDetail`). Builds the `ViewerContext` from the
 * session + `WholesalerSettings.piiMaskingMode`, then returns the role-correct
 * DTO: wholesaler/saas get the full shape, dealers get cost keys physically
 * removed (`toProjectInfoDealerDto`).
 */
export async function getCustomerProjectInfo(
  customerId: string,
): Promise<ProjectInfoDto | ProjectInfoForDealerDto> {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
    });
  }
  const ctx = await getTenantContext();
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
    action: "customer.read",
  });

  const isDealer = !!ctx.dealerId && !ctx.isSaasAdmin;
  const tenantType: ViewerContext["tenantType"] = ctx.isSaasAdmin
    ? "SAAS_ADMIN"
    : isDealer
      ? "DEALER"
      : "WHOLESALER";
  const role = (session.user.roles[0] ?? "WHOLESALER_ADMIN") as ViewerContext["role"];

  const piiMaskingMode = await withTenant(ctx, async (tx) => {
    if (!ctx.wholesalerId) return "MASKED" as const;
    const settings = await tx.wholesalerSettings.findUnique({
      where: { wholesalerId: ctx.wholesalerId },
      select: { piiMaskingMode: true },
    });
    return (settings?.piiMaskingMode ?? "MASKED") as "FULL" | "PARTIAL" | "MASKED";
  });

  const viewer: ViewerContext = {
    role,
    tenantType,
    isSelfTenant: true,
    piiMaskingMode,
  };

  const dto = await getProjectInfo(ctx, customerId, viewer);
  return isDealer ? toProjectInfoDealerDto(dto) : toProjectInfoWholesalerDto(dto);
}
