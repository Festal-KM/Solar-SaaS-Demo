// Shared constants + types for the wholesaler customer list.
//
// This module is intentionally free of "server-only" so client components
// (page-size-select / customer-table / customer-filter) can import the runtime
// constants and types without pulling the server-only data loader (data.ts)
// into their bundle.

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export type ContractStatusValue = "negotiating" | "contracted" | "lost" | "cancelled";
export type ConstructionStatusValue = "not_started" | "in_progress" | "done";
export type SubsidyStatusValue = "none" | "applying" | "granted";
export type MaekakuValue = "present" | "absent";

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
