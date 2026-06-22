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
export type ConstructionStatusValue = "not_started" | "in_progress" | "done";
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
