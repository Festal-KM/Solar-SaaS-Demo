import Link from "next/link";

import { labels } from "@/lib/i18n/labels";

import { listPlanRows } from "./data";

// S-016 — プラン管理一覧 (T-02-09 / F-005). テナント別の現在プラン + 直近の
// plan 変更日。行クリックで `/plans/[tenantId]` 詳細・履歴・適用フォームへ。

export const dynamic = "force-dynamic";

export default async function PlansListPage() {
  const rows = await listPlanRows();
  const t = labels.saasAdminPlan;
  const tt = labels.saasAdminTenant;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.listTitle}</h1>
        <p className="text-muted-foreground text-sm">{t.listSubtitle}</p>
      </div>

      <p className="text-muted-foreground text-xs">{t.notices.external}</p>

      {rows.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t.fields.name}</th>
                <th className="px-3 py-2 font-medium">{t.fields.currentPlan}</th>
                <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                <th className="px-3 py-2 font-medium">{t.fields.lastChangedAt}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-border border-t">
                  <td className="px-3 py-2">
                    <Link
                      href={`/plans/${r.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.plan ? tt.plans[r.plan] : c.notSet}</td>
                  <td className="px-3 py-2">{tt.statuses[r.status]}</td>
                  <td className="text-muted-foreground px-3 py-2 text-xs">
                    {r.lastChangedAt ? new Date(r.lastChangedAt).toLocaleString("ja-JP") : "—"}
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
