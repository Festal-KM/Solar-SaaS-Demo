// F-061「顧客詳細 案件情報 統合ビュー」のレスポンス型 + 二次店向け物理除外
// (docs/05 §16.9 / §16.10 / CLAUDE.md rule #5).
//
// `ProjectInfoDto` は 9 カテゴリ（§16.2）のネスト構造。設備明細はカテゴリ別配列、
// `age` は算出値（DB 非保持）。仕入値・原価系フィールドは二次店ロールでは
// destructure-and-rest で物理除去し、`Object.keys` に一切出さない（#5）。

// 二次店レスポンスで物理除外するキーの共通集合（Object.keys に出さない）。
export const DEALER_OMITTED_FINANCIAL_KEYS = [
  "snapshotPurchasePrice",
  "purchaseTotal",
  "dealerTotal",
  "constructionFee",
  "constructionFeeBreakdown",
  "otherCost",
] as const;

export type EquipmentCategoryKey = "PV" | "BT" | "EQ" | "IH" | "AC" | "ACCESSORY" | "GIFT";

export interface EquipmentItemDto {
  id: string;
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
  // snapshotPurchasePrice は二次店レスポンスで物理除外（contractItem 経由原価を出さない）。
  snapshotPurchasePrice?: number | null;
}

export type EquipmentByCategory = Record<EquipmentCategoryKey, EquipmentItemDto[]>;

export interface ProjectContractDto {
  contractId: string;
  contractDate: string | null;
  docsUrl: string | null;
  proposedAmount: number | null;
  contractAmount: number | null;
  paymentCount: number | null;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | null;
  depositDate: string | null;
  dealerPayoutDate: string | null;
  loanReviewCallAt: string | null;
  loanCompany: string | null;
  downPayment: number | null;
  creditLifeInsurance: boolean | null;
  loanNote: string | null;
  callStatus: "NONE" | "SCHEDULED" | "DONE" | "CALLBACK_WAIT" | "NG";
  equipmentSerialId: string | null;
  representativeConstructionId: string | null;
  equipment: EquipmentByCategory;
}

export interface ProjectConstructionDto {
  constructionId: string;
  contractId: string;
  surveyDate: string | null;
  surveyCandidates: unknown | null;
  constructionCandidates: unknown | null;
  startedDate: string | null;
  completedDate: string | null;
  powerSaleStartDate: string | null;
  status: string;
  postCompletionStatus: "NONE" | "IN_PROGRESS" | "DONE";
  defectStatus: "NONE" | "OPEN" | "RESOLVED";
  defectDetail: string | null;
  vendorName: string | null;
  thankYouCallAt: string | null;
  // fee は二次店レスポンスで物理除外（DEALER_OMITTED_FINANCIAL_KEYS）。
  fee?: number | null;
}

export interface ProjectApplicationDto {
  applicationId: string;
  status: string;
  type: string | null;
  submittedDate: string | null;
  approvedDate: string | null;
  grantedAmount: number | null;
}

export interface ProjectActivityDto {
  activityId: string;
  category: string;
  amount: number | null;
  occurredAt: string;
  body: string | null;
}

export interface ProjectFinancialsDto {
  contractAmount: number | null;
  proposedAmount: number | null;
  incentiveGrossProfit: number | null;
  incentiveAmount: number | null;
  // wholesaler/saas のみ存在（二次店では Object.keys に出ない）。
  purchaseTotal?: number;
  dealerTotal?: number;
  constructionFee?: number;
  constructionFeeBreakdown?: unknown;
  otherCost?: number;
}

export interface ProjectInfoDto {
  basic: {
    customerId: string;
    name: string;
    kana: string | null;
    birthDate: string;
    age: number | null;
    postalCode: string | null;
    address: string;
    phone: string;
    email: string | null;
    buildYear: string | null;
  };
  organization: {
    tossUpUserName: string | null;
    closingUserName: string | null;
    tossDept: string | null;
    belongDept: string | null;
  };
  contracts: ProjectContractDto[];
  constructions: ProjectConstructionDto[];
  applications: ProjectApplicationDto[];
  activities: ProjectActivityDto[];
  note: string | null;
  overview: {
    electricBill: string | null;
    household: string | null;
    housingType: string | null;
    inflowRoute: string | null;
    maekakuStatus: string | null;
  };
  financials: ProjectFinancialsDto;
}

// ---------------------------------------------------------------------------
// 代表 Construction 選定（§16.2 カテゴリ 5 の行選択ルール）.
//
// 選定順:
//   ① surveyDate / plannedDate / startedDate / completedDate の最新（進行中・直近）の行
//   ② 同点時は updatedAt 降順
//   ③ いずれの日付も null なら createdAt 降順の先頭
// ---------------------------------------------------------------------------

export interface ConstructionForPick {
  id: string;
  surveyDate: Date | string | null;
  plannedDate: Date | string | null;
  startedDate: Date | string | null;
  completedDate: Date | string | null;
  updatedAt: Date | string;
  createdAt: Date | string;
}

function toMillis(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

function latestStageMillis(c: ConstructionForPick): number | null {
  const stamps = [c.surveyDate, c.plannedDate, c.startedDate, c.completedDate]
    .map(toMillis)
    .filter((t): t is number => t != null);
  return stamps.length > 0 ? Math.max(...stamps) : null;
}

/**
 * Pick the representative `Construction` for a contract (§16.2). Returns `null`
 * for an empty list. Pure — accepts the minimal projection above.
 */
export function pickRepresentativeConstruction<T extends ConstructionForPick>(
  constructions: readonly T[],
): T | null {
  if (constructions.length === 0) return null;
  return [...constructions].sort((a, b) => {
    const sa = latestStageMillis(a);
    const sb = latestStageMillis(b);
    // ① latest stage date — rows with a stage date rank above rows without one.
    if (sa != null && sb != null && sa !== sb) return sb - sa;
    if (sa != null && sb == null) return -1;
    if (sa == null && sb != null) return 1;
    // ② updatedAt desc
    const ua = toMillis(a.updatedAt) ?? 0;
    const ub = toMillis(b.updatedAt) ?? 0;
    if (ua !== ub) return ub - ua;
    // ③ createdAt desc
    const ca = toMillis(a.createdAt) ?? 0;
    const cb = toMillis(b.createdAt) ?? 0;
    return cb - ca;
  })[0]!;
}

// ---------------------------------------------------------------------------
// 二次店向け物理除外（destructure-and-rest）. `Object.keys` に原価系キーが
// 一切現れないことを保証する（#5）。wholesaler/saas はそのまま identity 投影。
// ---------------------------------------------------------------------------

export type EquipmentItemForDealerDto = Omit<EquipmentItemDto, "snapshotPurchasePrice">;
export type ProjectConstructionForDealerDto = Omit<ProjectConstructionDto, "fee">;
export type ProjectFinancialsForDealerDto = Omit<
  ProjectFinancialsDto,
  "purchaseTotal" | "dealerTotal" | "constructionFee" | "constructionFeeBreakdown" | "otherCost"
>;

export interface ProjectContractForDealerDto
  extends Omit<ProjectContractDto, "equipment"> {
  equipment: Record<EquipmentCategoryKey, EquipmentItemForDealerDto[]>;
}

export interface ProjectInfoForDealerDto
  extends Omit<ProjectInfoDto, "contracts" | "constructions" | "financials"> {
  contracts: ProjectContractForDealerDto[];
  constructions: ProjectConstructionForDealerDto[];
  financials: ProjectFinancialsForDealerDto;
}

const EQUIPMENT_CATEGORY_KEYS: EquipmentCategoryKey[] = [
  "PV",
  "BT",
  "EQ",
  "IH",
  "AC",
  "ACCESSORY",
  "GIFT",
];

function stripEquipmentItem(item: EquipmentItemDto): EquipmentItemForDealerDto {
  const { snapshotPurchasePrice: _omit, ...rest } = item;
  return rest;
}

/**
 * Wholesaler / saas_admin projection — identity. Named so every wire boundary
 * routes through either this or `toProjectInfoDealerDto` (grep-friendly).
 */
export function toProjectInfoWholesalerDto(dto: ProjectInfoDto): ProjectInfoDto {
  return dto;
}

/**
 * Dealer projection — physically removes every cost-bearing key
 * (`DEALER_OMITTED_FINANCIAL_KEYS`) from the financials, each construction
 * (`fee`), and each equipment item (`snapshotPurchasePrice`). The removed keys
 * do not appear in `Object.keys` of the returned objects (#5).
 */
export function toProjectInfoDealerDto(dto: ProjectInfoDto): ProjectInfoForDealerDto {
  const {
    purchaseTotal: _pt,
    dealerTotal: _dt,
    constructionFee: _cf,
    constructionFeeBreakdown: _cfb,
    otherCost: _oc,
    ...financials
  } = dto.financials;

  const constructions = dto.constructions.map((c) => {
    const { fee: _fee, ...rest } = c;
    return rest;
  });

  const contracts = dto.contracts.map((c) => {
    const equipment = {} as Record<EquipmentCategoryKey, EquipmentItemForDealerDto[]>;
    for (const key of EQUIPMENT_CATEGORY_KEYS) {
      equipment[key] = c.equipment[key].map(stripEquipmentItem);
    }
    return { ...c, equipment };
  });

  return { ...dto, contracts, constructions, financials };
}

/** Empty `EquipmentByCategory` builder for loaders. */
export function emptyEquipmentByCategory(): EquipmentByCategory {
  return {
    PV: [],
    BT: [],
    EQ: [],
    IH: [],
    AC: [],
    ACCESSORY: [],
    GIFT: [],
  };
}
