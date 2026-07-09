// Shared constants + types for the wholesaler customer list.
//
// This module is intentionally free of "server-only" so client components
// (page-size-select / customer-table / customer-filter) can import the runtime
// constants and types without pulling the server-only data loader (data.ts)
// into their bundle.

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export type ContractStatusValue =
  | "pre_visit"
  | "negotiating"
  | "quote_presented"
  | "contract_pending"
  | "contracted"
  | "lost"
  | "cancelled";
// 施工状況（4 値）: 現地調査前 / 施工前 / 施工中 / 完工。
export type ConstructionStatusValue = "not_started" | "surveyed" | "in_progress" | "done";
export type SubsidyStatusValue =
  | "not_applied"
  | "preparing"
  | "applied"
  | "revising"
  | "completed";
export type SurveyStatusValue = "not_surveyed" | "scheduled" | "surveyed";
export type MaekakuValue = "present" | "absent";

// 表示順・値域の単一の真実（フィルタ / page / api route が共有）。
export const CONTRACT_STATUS_VALUES: ContractStatusValue[] = [
  "pre_visit",
  "negotiating",
  "quote_presented",
  "contract_pending",
  "contracted",
  "lost",
  "cancelled",
];
export const CONSTRUCTION_STATUS_VALUES: ConstructionStatusValue[] = [
  "not_started",
  "surveyed",
  "in_progress",
  "done",
];
export const SUBSIDY_STATUS_VALUES: SubsidyStatusValue[] = [
  "not_applied",
  "preparing",
  "applied",
  "revising",
  "completed",
];
export const SURVEY_STATUS_VALUES: SurveyStatusValue[] = [
  "not_surveyed",
  "scheduled",
  "surveyed",
];

// Construction.status (enum) の「施工中」相当集合。一覧の施工状況（4 値）導出に使う。
export const CONSTRUCTION_IN_PROGRESS_ENUMS = ["CONSTRUCTING", "PAUSED"] as const;

// ConstructionStatus(enum) → 一覧列の 4 値（not_started/surveyed/in_progress/done）マッピング。
// REQUEST_PENDING・REQUESTED=現地調査前 / SURVEYED=施工前 / CONSTRUCTING・PAUSED=施工中 /
// DONE=完工（labels.constructionStatusLabels と整合）。
export function constructionEnumToStatusValue(status: string): ConstructionStatusValue {
  if (status === "DONE") return "done";
  if (status === "SURVEYED") return "surveyed";
  if (status === "CONSTRUCTING" || status === "PAUSED") return "in_progress";
  // REQUEST_PENDING / REQUESTED
  return "not_started";
}

// 顧客の Construction 群から代表施工の状況を導出する。固定優先順位
// 「施工中(in_progress) > 完工(done) > 施工前(surveyed) > 現地調査前(not_started)」で分類し、
// DB 側の buildConstructionStatusWhere の分岐と完全一致させる。これにより一覧の表示ラベルと
// 施工状況フィルタの結果が常に一致する。施工が無ければフォールバック（Customer.constructionStatus）。
export function deriveConstructionStatusValue(
  constructions: { status: string }[],
  fallback: ConstructionStatusValue,
): ConstructionStatusValue {
  if (constructions.length === 0) return fallback;
  const values = constructions.map((c) => constructionEnumToStatusValue(c.status));
  if (values.includes("in_progress")) return "in_progress";
  if (values.includes("done")) return "done";
  if (values.includes("surveyed")) return "surveyed";
  return "not_started";
}

export interface CustomerListFilter {
  query?: string;
  contractStatus?: ContractStatusValue;
  constructionStatus?: ConstructionStatusValue;
  subsidyStatus?: SubsidyStatusValue;
  assigneeUserId?: string;
  maekaku?: MaekakuValue;
  page?: number;
  pageSize?: PageSize;
}

export interface CustomerListItem {
  id: string;
  name: string;
  area: string | null;
  assigneeName: string;
  nextAppointmentAt: string | null;
  maekaku: MaekakuValue;
  contractStatus: ContractStatusValue;
  constructionStatus: ConstructionStatusValue;
  subsidyStatus: SubsidyStatusValue;
  updatedAt: string;
}

export interface PagedCustomerResult {
  items: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function normalizePageSize(value: number | undefined): PageSize {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value ?? -1)
    ? (value as PageSize)
    : DEFAULT_PAGE_SIZE;
}
