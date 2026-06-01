import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { listVenueNegotiations } from "./data";
import { NegotiationRow } from "./negotiation-row";

import type { VenueNegotiationStatus } from "@solar/contracts";

// S-021 — 場所提供元対応一覧 (F-017, docs/04 §1.3 §S-021).
//
// Filter by ステータス + 場所提供元名 (substring). Renders a plain `<table>`
// matching the venue-provider master pattern; the shadcn DataTable migration
// is tracked under the same TODO note as S-019.

export const dynamic = "force-dynamic";

const VALID_STATUSES: VenueNegotiationStatus[] = [
  "NOT_CONTACTED",
  "CONTACTING",
  "CONDITION_REVIEW",
  "FEASIBLE",
  "INFEASIBLE",
  "FIXED",
  "CANCELLED",
];

function coerceStatus(value: string | undefined): VenueNegotiationStatus | undefined {
  if (!value) return undefined;
  return (VALID_STATUSES as readonly string[]).includes(value)
    ? (value as VenueNegotiationStatus)
    : undefined;
}

interface PageProps {
  searchParams: Promise<{ status?: string; storeName?: string }>;
}

export default async function VenueNegotiationsListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = coerceStatus(params.status);
  const storeName = params.storeName?.trim() ?? "";

  const rows = await listVenueNegotiations({
    ...(status ? { status } : {}),
    ...(storeName ? { storeName } : {}),
  });

  const t = labels.venueNegotiation;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium text-carbon-dark">{t.title}</h1>
          <p className="text-pewter text-sm mt-1">{t.listTitle}</p>
        </div>
        <Button asChild>
          <Link href="/venue-negotiations/new">{t.new}</Link>
        </Button>
      </div>

      <form method="get" className="flex max-w-2xl items-center gap-3 mb-4">
        <Input
          type="search"
          name="storeName"
          defaultValue={storeName}
          placeholder={t.searchByStoreName}
          aria-label={t.searchByStoreName}
          className="h-9"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label={t.filterByStatus}
          className="border border-cloud-gray bg-white rounded-sm h-9 px-3 py-2 text-sm text-carbon-dark focus:outline-none focus:ring-2 focus:ring-electric-blue/20 focus:border-electric-blue"
        >
          <option value="">{t.allStatuses}</option>
          {VALID_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.statuses[s]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          {c.search}
        </Button>
      </form>

      {rows.length === 0 ? (
        <div className="border border-cloud-gray rounded-lg p-12 text-center">
          <p className="text-carbon-dark font-medium">{t.empty}</p>
          <p className="text-pewter mt-2 text-sm">{t.emptyCta}</p>
          <Button asChild className="mt-4">
            <Link href="/venue-negotiations/new">{t.new}</Link>
          </Button>
        </div>
      ) : (
        <div className="border border-cloud-gray overflow-x-auto rounded-lg">
          <table>
            <thead>
              <tr>
                <th>{t.fields.venueProvider}</th>
                <th>{t.fields.area}</th>
                <th>{t.fields.status}</th>
                <th>{t.fields.nextAction}</th>
                <th>{t.fields.assigneeId}</th>
                <th>{t.fields.updatedAt}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <NegotiationRow key={r.id} href={`/venue-negotiations/${r.id}`}>
                  <td className="text-electric-blue">{r.venueProviderName}</td>
                  <td>{r.venueProviderArea ?? "—"}</td>
                  <td>{t.statuses[r.status]}</td>
                  <td>{r.nextAction ?? "—"}</td>
                  <td>{r.assigneeId ?? "—"}</td>
                  <td className="text-pewter text-xs">
                    {new Date(r.updatedAt).toLocaleString("ja-JP")}
                  </td>
                </NegotiationRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
