import Link from "next/link";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { listTenants } from "./data";

import type { TenantPlanValue, TenantStatusValue, TenantTypeValue } from "@solar/contracts";

// S-014 — 卸業者テナント一覧 (F-004 / docs/04 §1.2). フィルタ (種別 / プラン /
// ステータス) は GET フォームで URL に持つので RSC 再描画で反映される。
// shadcn DataTable への置き換えは後続スプリント（venue-providers と同じ方針）。

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ type?: string; plan?: string; status?: string }>;
}

function normaliseType(v: string | undefined): TenantTypeValue | undefined {
  return v === "WHOLESALER" || v === "DEALER" ? v : undefined;
}
function normalisePlan(v: string | undefined): TenantPlanValue | undefined {
  return v === "PILOT" || v === "SMALL" || v === "MEDIUM" || v === "LARGE" ? v : undefined;
}
function normaliseStatus(v: string | undefined): TenantStatusValue | undefined {
  return v === "ACTIVE" || v === "SUSPENDED" ? v : undefined;
}

export default async function TenantsListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const type = normaliseType(params.type);
  const plan = normalisePlan(params.plan);
  const status = normaliseStatus(params.status);

  const rows = await listTenants({
    ...(type ? { type } : {}),
    ...(plan ? { plan } : {}),
    ...(status ? { status } : {}),
  });

  const t = labels.saasAdminTenant;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.listTitle}</h1>
          <p className="text-muted-foreground text-sm">{t.listSubtitle}</p>
        </div>
        <Button asChild>
          <Link href="/tenants/new">{t.new}</Link>
        </Button>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t.filters.type}</span>
          <select
            name="type"
            defaultValue={type ?? ""}
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            aria-label={t.filters.type}
          >
            <option value="">{t.filters.all}</option>
            <option value="WHOLESALER">{t.types.WHOLESALER}</option>
            <option value="DEALER">{t.types.DEALER}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t.filters.plan}</span>
          <select
            name="plan"
            defaultValue={plan ?? ""}
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            aria-label={t.filters.plan}
          >
            <option value="">{t.filters.all}</option>
            <option value="PILOT">{t.plans.PILOT}</option>
            <option value="SMALL">{t.plans.SMALL}</option>
            <option value="MEDIUM">{t.plans.MEDIUM}</option>
            <option value="LARGE">{t.plans.LARGE}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t.filters.status}</span>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            aria-label={t.filters.status}
          >
            <option value="">{t.filters.all}</option>
            <option value="ACTIVE">{t.statuses.ACTIVE}</option>
            <option value="SUSPENDED">{t.statuses.SUSPENDED}</option>
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-10">
          {labels.common.search}
        </Button>
      </form>

      {rows.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
          <Button asChild className="mt-4">
            <Link href="/tenants/new">{t.new}</Link>
          </Button>
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t.fields.name}</th>
                <th className="px-3 py-2 font-medium">{t.fields.type}</th>
                <th className="px-3 py-2 font-medium">{t.fields.plan}</th>
                <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                <th className="px-3 py-2 font-medium">{t.fields.userCount}</th>
                <th className="px-3 py-2 font-medium">{t.fields.createdAt}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-border border-t">
                  <td className="px-3 py-2">
                    <Link
                      href={`/tenants/${r.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{t.types[r.type]}</td>
                  <td className="px-3 py-2">{r.plan ? t.plans[r.plan] : "—"}</td>
                  <td className="px-3 py-2">{t.statuses[r.status]}</td>
                  <td className="px-3 py-2 tabular-nums">{r.userCount}</td>
                  <td className="text-muted-foreground px-3 py-2 text-xs">
                    {new Date(r.createdAt).toLocaleString("ja-JP")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
