// S-032 — 卸業者側 顧客一覧・検索 (T-04-07 / F-032 / docs/04 §1.3).
//
// Card-wrapped table with four independent derived status dimensions, a
// search + filter bar (client component pushing query params) and numeric
// pagination with a page-size selector. PII masking is applied in the data
// loader according to WholesalerSettings.

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

import { CustomerFilter } from "./customer-filter";
import { CustomerTable } from "./customer-table";
import {
  listCustomers,
  listWholesalerUsers,
  normalizePageSize,
  type ContractStatusValue,
  type ConstructionStatusValue,
  type MaekakuValue,
  type SubsidyStatusValue,
} from "./data";
import { PageSizeSelect } from "./page-size-select";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    query?: string;
    assigneeUserId?: string;
    contractStatus?: string;
    constructionStatus?: string;
    subsidyStatus?: string;
    maekaku?: string;
    page?: string;
    pageSize?: string;
  }>;
}

const VALID_CONTRACT: ContractStatusValue[] = ["negotiating", "contracted", "lost", "cancelled"];
const VALID_CONSTRUCTION: ConstructionStatusValue[] = ["not_started", "in_progress", "done"];
const VALID_SUBSIDY: SubsidyStatusValue[] = ["none", "applying", "granted"];
const VALID_MAEKAKU: MaekakuValue[] = ["present", "absent"];

// Windowed numeric pagination (max 5 buttons centred on the current page).
function pageWindow(current: number, totalPages: number): number[] {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
  let start = Math.max(1, current - 2);
  const end = Math.min(totalPages, start + 4);
  start = Math.max(1, end - 4);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export default async function WholesalerCustomerListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const contractStatus = VALID_CONTRACT.includes(params.contractStatus as ContractStatusValue)
    ? (params.contractStatus as ContractStatusValue)
    : undefined;
  const constructionStatus = VALID_CONSTRUCTION.includes(
    params.constructionStatus as ConstructionStatusValue,
  )
    ? (params.constructionStatus as ConstructionStatusValue)
    : undefined;
  const subsidyStatus = VALID_SUBSIDY.includes(params.subsidyStatus as SubsidyStatusValue)
    ? (params.subsidyStatus as SubsidyStatusValue)
    : undefined;
  const assigneeUserId = params.assigneeUserId?.trim() || undefined;
  const maekaku = VALID_MAEKAKU.includes(params.maekaku as MaekakuValue)
    ? (params.maekaku as MaekakuValue)
    : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const pageSize = normalizePageSize(parseInt(params.pageSize ?? "", 10) || undefined);

  const [result, assignees] = await Promise.all([
    listCustomers({
      query,
      assigneeUserId,
      contractStatus,
      constructionStatus,
      subsidyStatus,
      maekaku,
      page,
      pageSize,
    }),
    listWholesalerUsers(),
  ]);

  const t = labels.customer;

  // Build pagination URL preserving other query params.
  function pageUrl(p: number): string {
    const sp = new URLSearchParams();
    if (query) sp.set("query", query);
    if (assigneeUserId) sp.set("assigneeUserId", assigneeUserId);
    if (contractStatus) sp.set("contractStatus", contractStatus);
    if (constructionStatus) sp.set("constructionStatus", constructionStatus);
    if (subsidyStatus) sp.set("subsidyStatus", subsidyStatus);
    if (maekaku) sp.set("maekaku", maekaku);
    if (pageSize !== 20) sp.set("pageSize", String(pageSize));
    sp.set("page", String(p));
    return `/customers?${sp.toString()}`;
  }

  const pageText = t.pagination.pageOf
    .replace("{page}", String(result.page))
    .replace("{total}", String(Math.max(1, result.totalPages)));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t.listTitle}</h1>
          <p className="mt-1 text-sm text-mute-light">{t.subtitle}</p>
        </div>
        <Button asChild>
          <Link href="/customers/new">{t.newShort}</Link>
        </Button>
      </div>

      <Card className="p-4">
        <CustomerFilter
          query={query}
          assigneeUserId={assigneeUserId ?? ""}
          contractStatus={contractStatus ?? ""}
          constructionStatus={constructionStatus ?? ""}
          subsidyStatus={subsidyStatus ?? ""}
          maekaku={maekaku ?? ""}
          assignees={assignees}
        />
      </Card>

      <p className="text-sm text-mute-light">
        {t.filters.resultCount.replace("{total}", String(result.total))}
      </p>

      <Card className="overflow-hidden p-0">
        {result.items.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-medium text-ink">{t.empty}</p>
            <p className="mt-2 text-sm text-mute-light">{t.emptyCta}</p>
            <Button asChild className="mt-4">
              <Link href="/customers/new">{t.new}</Link>
            </Button>
          </div>
        ) : (
          <CustomerTable customers={result.items} />
        )}
      </Card>

      {result.items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-mute-light">{t.pageSize.displayCount}</span>
            <PageSizeSelect pageSize={result.pageSize} />
          </div>

          <div className="flex items-center gap-1">
            <Button
              asChild={result.page > 1}
              variant="outline"
              size="icon"
              className="h-9 w-9"
              disabled={result.page <= 1}
              aria-label={t.pagination.first}
            >
              {result.page > 1 ? (
                <Link href={pageUrl(1)}>
                  <ChevronsLeft />
                </Link>
              ) : (
                <ChevronsLeft />
              )}
            </Button>

            <Button
              asChild={result.page > 1}
              variant="outline"
              size="icon"
              className="h-9 w-9"
              disabled={result.page <= 1}
              aria-label={t.pagination.prev}
            >
              {result.page > 1 ? (
                <Link href={pageUrl(result.page - 1)}>
                  <ChevronLeft />
                </Link>
              ) : (
                <ChevronLeft />
              )}
            </Button>

            {pageWindow(result.page, result.totalPages).map((p) => (
              <Button
                key={p}
                asChild={p !== result.page}
                variant={p === result.page ? "default" : "outline"}
                size="icon"
                className="h-9 w-9 tabular-nums"
              >
                {p === result.page ? <span>{p}</span> : <Link href={pageUrl(p)}>{p}</Link>}
              </Button>
            ))}

            <Button
              asChild={result.page < result.totalPages}
              variant="outline"
              size="icon"
              className="h-9 w-9"
              disabled={result.page >= result.totalPages}
              aria-label={t.pagination.next}
            >
              {result.page < result.totalPages ? (
                <Link href={pageUrl(result.page + 1)}>
                  <ChevronRight />
                </Link>
              ) : (
                <ChevronRight />
              )}
            </Button>

            <Button
              asChild={result.page < result.totalPages}
              variant="outline"
              size="icon"
              className="h-9 w-9"
              disabled={result.page >= result.totalPages}
              aria-label={t.pagination.last}
            >
              {result.page < result.totalPages ? (
                <Link href={pageUrl(result.totalPages)}>
                  <ChevronsRight />
                </Link>
              ) : (
                <ChevronsRight />
              )}
            </Button>
          </div>

          <span className="text-sm tabular-nums text-mute-light">{pageText}</span>
        </div>
      )}
    </div>
  );
}
