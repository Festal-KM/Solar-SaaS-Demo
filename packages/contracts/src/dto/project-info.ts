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

// F-063 既設設備（現況）で二次店レスポンスから物理除外する詳細キー（docs/05 §17.5 /
// §17.7）。二次店には「有無＋大分類」（category + installed）まで。Object.keys に出さない。
export const DEALER_OMITTED_EXISTING_EQUIPMENT_KEYS = [
  "installDate",
  "maker",
  "capacityKw",
  "panelCount",
  "attributes",
] as const;

// CONSTRUCTION = 契約商材ラインとしての施工（金額・業者・内容）。施工状況タブの
// Construction（工事進捗・fee 原価）とは別概念。
export type EquipmentCategoryKey =
  | "PV"
  | "BT"
  | "EQ"
  | "IH"
  | "AC"
  | "ACCESSORY"
  | "GIFT"
  | "CONSTRUCTION";

export interface EquipmentItemDto {
  id: string;
  contracted: boolean;
  // 商材ごとの契約金額（顧客向け・原価ではない）。二次店にも表示してよい。
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
  // ローン審査ステータス（バッチ C）。CODE（not_reviewed/reviewing/completed/defect）。
  loanReviewStatus: string | null;
  callStatus: "NONE" | "SCHEDULED" | "DONE" | "CALLBACK_WAIT" | "NG";
  equipmentSerialId: string | null;
  representativeConstructionId: string | null;
  // 契約サブタブの表示名（ユーザー編集・業務ラベル）。null はデフォルト表記（契約#N）。
  tabLabel: string | null;
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
  // 現地調査ステータス（施工ステータスとは別管理）: not_surveyed/scheduled/surveyed/null。
  surveyStatus: string | null;
  postCompletionStatus: "NONE" | "IN_PROGRESS" | "DONE";
  defectStatus: "NONE" | "OPEN" | "RESOLVED";
  defectDetail: string | null;
  vendorName: string | null;
  thankYouCallAt: string | null;
  // 施工サブタブの表示名（ユーザー編集・業務ラベル）。null はデフォルト表記（施工#N）。
  tabLabel: string | null;
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

// 契約単位の損益（GrossProfit 1:1）。売上・各原価・粗利を機密財務として保持する。
// セクション丸ごと二次店レスポンスから物理除外（toProjectInfoDealerDto / #4・#5）。
// GrossProfit 未計算の契約は配列に含めない（UI 側で「未計算」空状態）。
export interface ProjectProfitDto {
  contractId: string;
  contractDate: string | null;
  salesPrice: number;
  purchaseTotal: number;
  dealerTotal: number;
  constructionFee: number;
  otherCost: number;
  discount: number;
  projectProfit: number;
  wholesaleProfit: number;
  profitRate: number; // 0..1（UI で % 表示）
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

// F-063 既設設備（現況）DTO（docs/05 §17.7）。ContractEquipment（契約後設備）とは
// 別概念・別カテゴリ。詳細キー（installDate/maker/capacityKw/panelCount/attributes）は
// 二次店ロールでは物理除外（destructure-and-rest、Object.keys に出さない／#5・§17.5）。
export interface ExistingEquipmentDto {
  id: string;
  category: "GAS_WATER_HEATER" | "ECO_CUTE" | "PV";
  installed: "YES" | "NO" | "UNKNOWN";
  // ↓ wholesaler/saas のみ存在（二次店では Object.keys に出ない）。
  installDate?: string | null;
  maker?: string | null;
  capacityKw?: number | null;
  panelCount?: number | null;
  attributes?: Record<string, unknown> | null;
}

// 既設設備の詳細キーを除いた二次店向け射影（有無＋大分類のみ）。
export type ExistingEquipmentForDealerDto = Omit<
  ExistingEquipmentDto,
  "installDate" | "maker" | "capacityKw" | "panelCount" | "attributes"
>;

// F-063 ヒアリング（住環境・家族）カテゴリ（docs/05 §17.7）。家族属性・分離電話は
// MaskingService 適用済みの文字列。既設設備は契約後設備とは別カテゴリで保持。
export interface ProjectHearingDto {
  husbandAge: string | null; // maskFamilyAge 適用後（'40代' / '45歳' / '未設定'）
  wifeAge: string | null;
  childAge: string | null;
  household: string | null;
  guideAttendee: "HUSBAND" | "WIFE" | "BOTH" | "OTHER" | null;
  faceToFace: boolean | null;
  proposedProduct: string | null;
  landlinePhone: string; // maskLandlinePhone 適用後
  mobilePhone: string; // maskMobilePhone 適用後
  maekakuPreferredAt: string | null;
  acquiredAt: string | null; // Appointment.acquiredAt（代表アポ）
  existingEquipments: ExistingEquipmentDto[];
}

// 単体取得用（getCustomerHearing）。ProjectInfoDto.hearing と同形（docs/05 §17.9）。
export type CustomerHearingDto = ProjectHearingDto;
export type CustomerHearingForDealerDto = ProjectHearingForDealerDto;

// 過去コール履歴 1 件（CustomerCallLog・画面から追加するシンプルな架電実績）。
// 架電日時 / 対応者（自社 User 名・マスク対象外）/ メモ のみ。
export interface ProjectCallLogDto {
  id: string;
  calledAt: string;
  handlerName: string | null;
  note: string | null;
}

// コール状況（コールタブ 4 セクション）。各コール（マエカク / サンキュー / ローン審査完了 /
// 施工完了）のステータス + 希望日時 + メモ。ステータス CODE: マエカクは pending/done/
// unnecessary、その他は CALL_STATUS_VALUES（not_done/done/unnecessary）。マエカク希望日時は
// 商談履歴タブと共用列。landlinePhone/mobilePhone は連絡先 PII（maskLandlinePhone/
// maskMobilePhone 適用後）でコールタブ上部に表示。callLogs は画面から追加する過去コール履歴。
// nextAppointmentAt/nextAppointmentAssigneeName/nextAction は商談タブ編集値の read-only 表示。
export interface ProjectCallsDto {
  // コールタブ上部の固定電話・携帯電話（マスク済み）。
  landlinePhone: string; // maskLandlinePhone 適用後
  mobilePhone: string; // maskMobilePhone 適用後
  maekakuStatus: string | null;
  maekakuPreferredAt: string | null;
  maekakuCallNote: string | null;
  // 次回アポ（商談タブで編集・コールタブ read-only）。
  nextAppointmentAt: string | null;
  nextAppointmentAssigneeName: string | null; // 自社 User 名（マスク対象外）
  nextAction: string | null;
  callLogs: ProjectCallLogDto[];
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

// ローン審査履歴ログ 1 件（LoanReviewLog・各審査内に画面から追加）。日時/結果/メモ/不備。
// 不備はログ登録時に記録し、「不備内容・解消状況」セクションがログ横断で一覧表示する。
// 原価でも PII でもないため二次店レスポンスにもそのまま含める（物理除外しない）。
export interface ProjectLoanReviewLogDto {
  id: string;
  reviewedAt: string;
  result: string; // approved/rejected/defect/other（CODE）
  note: string | null;
  defectContent: string | null; // 不備内容（null=不備なし。非 null のみ不備一覧に出る）
  defectResolved: boolean; // 不備解消フラグ
  assigneeUserId: string | null; // 不備の担当者（自社 User ID）。記録者とは別概念。
  assigneeName: string | null; // 担当者の解決済み表示名（自社 User 名・マスク対象外）
  handlerName: string | null; // 記録者（自社 User 名・マスク対象外）
}

// ローン審査 1 件（LoanReview・契約タブと同型のサブタブ）。ローン会社/頭金/団信/メモ +
// 過去の審査履歴ログ。不備は各ログ（logs[].defectContent）に持つ。ローン会社・頭金は
// 原価ではない（顧客向け・通常表示で可）ため二次店レスポンスにもそのまま含める（物理除外しない）。
export interface ProjectLoanReviewDto {
  loanReviewId: string;
  status: string; // not_reviewed/reviewing/completed/defect（CODE）
  loanCompany: string | null;
  downPayment: number | null;
  creditLifeInsurance: boolean | null;
  note: string | null;
  reviewedAt: string | null;
  // ローン審査サブタブの表示名（ユーザー編集・業務ラベル）。null はデフォルト表記（ローン審査#N）。
  tabLabel: string | null;
  logs: ProjectLoanReviewLogDto[];
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
  // 独立エンティティ「ローン審査」（顧客 1:N・契約タブと同型のサブタブ）。
  loanReviews: ProjectLoanReviewDto[];
  constructions: ProjectConstructionDto[];
  applications: ProjectApplicationDto[];
  activities: ProjectActivityDto[];
  note: string | null;
  // 特記事項（契約タブのフリーテキストメモ）。基本情報タブの note とは別概念。
  // 原価でも PII でもないため二次店レスポンスにもそのまま含める（物理除外しない）。
  specialNote: string | null;
  overview: {
    electricBill: string | null;
    household: string | null;
    housingType: string | null;
    inflowRoute: string | null;
    maekakuStatus: string | null;
  };
  financials: ProjectFinancialsDto;
  // 契約単位の損益計算（売上・原価・粗利）。機密財務のため二次店 DTO からは
  // セクション丸ごと物理除外（ProjectInfoForDealerDto に当該キー無し／#4・#5）。
  profitAndLoss: ProjectProfitDto[];
  // F-063 追加カテゴリ: ヒアリング（住環境・家族）。契約後設備 equipment（カテゴリ 7）とは別概念。
  hearing: ProjectHearingDto;
  // コール状況（完工/ローン完了コール・電話番号・過去コール履歴・次回アポ）。
  calls: ProjectCallsDto;
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

export type ProjectHearingForDealerDto = Omit<ProjectHearingDto, "existingEquipments"> & {
  existingEquipments: ExistingEquipmentForDealerDto[];
};

export interface ProjectInfoForDealerDto
  extends Omit<
    ProjectInfoDto,
    "contracts" | "constructions" | "financials" | "hearing" | "profitAndLoss"
  > {
  contracts: ProjectContractForDealerDto[];
  constructions: ProjectConstructionForDealerDto[];
  financials: ProjectFinancialsForDealerDto;
  hearing: ProjectHearingForDealerDto;
  // profitAndLoss は二次店レスポンスから物理除外（Object.keys に出ない／#4・#5）。
}

/**
 * Dealer projection for one existing-equipment row — physically removes every
 * detail key (`DEALER_OMITTED_EXISTING_EQUIPMENT_KEYS`). The removed keys do not
 * appear in `Object.keys` of the returned object (#5 / docs/05 §17.5).
 */
export function stripExistingEquipmentForDealer(
  eq: ExistingEquipmentDto,
): ExistingEquipmentForDealerDto {
  const {
    installDate: _id,
    maker: _mk,
    capacityKw: _ck,
    panelCount: _pc,
    attributes: _at,
    ...rest
  } = eq;
  return rest;
}

const EQUIPMENT_CATEGORY_KEYS: EquipmentCategoryKey[] = [
  "PV",
  "BT",
  "EQ",
  "IH",
  "AC",
  "ACCESSORY",
  "GIFT",
  "CONSTRUCTION",
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

  const hearing: ProjectHearingForDealerDto = {
    ...dto.hearing,
    existingEquipments: dto.hearing.existingEquipments.map(stripExistingEquipmentForDealer),
  };

  // 損益計算（売上・原価・粗利）はセクション丸ごと物理除外（profitAndLoss キーを
  // Object.keys に一切出さない／#4・#5）。
  const { profitAndLoss: _pnl, ...withoutProfit } = dto;

  return { ...withoutProfit, contracts, constructions, financials, hearing };
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
    CONSTRUCTION: [],
  };
}
