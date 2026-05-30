import Link from "next/link";

import { labels } from "@/lib/i18n/labels";

import { listBillingRows } from "../plans/data";

// S-017 — 請求状況一覧（オフライン記録）(T-02-09 / F-005).
//
// 請求書発行・決済は本システム外。MVP では「テナント名 / 現在プラン / 直近
// プラン変更日 / 内部メモ（最新の TenantPlanHistory.note）」を表示するだけ。
// 本格的な `BillingNote` テーブル + ステータス（請求中/入金待ち/入金済/督促）
// は後続スプリントで追加する余地を残す。

export const dynamic = "force-dynamic";

export default async function BillingListPage() {
  const rows = await listBillingRows();
  const t = labels.saasAdminPlan;
  const tt = labels.saasAdminTenant;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.billingTitle}</h1>
        <p className="text-muted-foreground text-sm">{t.billingSubtitle}</p>
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
                <th className="px-3 py-2 font-medium">{t.fields.latestNote}</th>
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
                  <td className="px-3 py-2 text-xs">{r.latestNote ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
