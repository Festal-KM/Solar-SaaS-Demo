import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { listVenueProviders } from "./data";

// S-019 — 場所提供元マスタ一覧 (F-011, docs/04 §1.3).
//
// Plain `<table>` per T-02-02 spec — TODO(SP-03 shadcn DataTable へ移行 —
// @tanstack/react-table 導入後). Filtering by 名称 / エリア (docs/04 §S-019)
// uses a GET form so the query string survives navigation and the RSC
// re-renders with the filtered list.

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ name?: string; area?: string }>;
}

export default async function VenueProvidersListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filterName = params.name?.trim() ?? "";
  const filterArea = params.area?.trim() ?? "";
  const rows = await listVenueProviders({
    ...(filterName ? { name: filterName } : {}),
    ...(filterArea ? { area: filterArea } : {}),
  });

  const t = labels.venueProvider;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium text-carbon-dark">{t.title}</h1>
          <p className="text-pewter text-sm mt-1">{t.listTitle}</p>
        </div>
        <Button asChild>
          <Link href="/masters/venue-providers/new">{t.new}</Link>
        </Button>
      </div>

      <form method="get" className="flex max-w-2xl items-center gap-3 mb-4">
        <Input
          type="search"
          name="name"
          defaultValue={filterName}
          placeholder={t.searchByName}
          aria-label={t.searchByName}
          className="h-9"
        />
        <Input
          type="search"
          name="area"
          defaultValue={filterArea}
          placeholder={t.searchByArea}
          aria-label={t.searchByArea}
          className="h-9"
        />
        <Button type="submit" variant="outline" size="sm">
          {c.search}
        </Button>
      </form>

      {rows.length === 0 ? (
        <div className="border border-cloud-gray rounded-lg p-12 text-center">
          <p className="text-carbon-dark font-medium">{t.empty}</p>
          <p className="text-pewter mt-2 text-sm">{t.emptyCta}</p>
          <Button asChild className="mt-4">
            <Link href="/masters/venue-providers/new">{t.new}</Link>
          </Button>
        </div>
      ) : (
        <div className="border border-cloud-gray overflow-x-auto rounded-lg">
          <table>
            <thead>
              <tr>
                <th>{t.fields.name}</th>
                <th>{t.fields.contactName}</th>
                <th>{t.fields.area}</th>
                <th>{t.fields.contractType}</th>
                <th>{t.fields.fixedFee}</th>
                <th>{t.fields.performanceRate}</th>
                <th>{t.fields.updatedAt}</th>
                <th>{t.fields.isActive}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      href={`/masters/venue-providers/${r.id}`}
                      className="text-electric-blue underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td>{r.contactName ?? "—"}</td>
                  <td>{r.area ?? "—"}</td>
                  <td>{r.contractType ? t.contractTypes[r.contractType] : "—"}</td>
                  <td className="tabular-nums">{r.fixedFee ?? "—"}</td>
                  <td className="tabular-nums">{r.performanceRate ?? "—"}</td>
                  <td className="text-pewter text-xs">
                    {new Date(r.updatedAt).toLocaleString("ja-JP")}
                  </td>
                  <td>{r.isActive ? c.active : c.inactive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
