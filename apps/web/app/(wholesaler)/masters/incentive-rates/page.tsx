import Link from "next/link";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { listIncentiveRates } from "./data";

// インセンティブ率マスタ 一覧 (S-052 sub / F-014). 関係（二次店）単位に
// グルーピングし、現在有効な率を強調表示する。新規作成は wholesaler_admin のみ
// （new/page.tsx で assertCan、ボタン自体は read 権限のあるロール全員に見える）。

export const dynamic = "force-dynamic";

export default async function IncentiveRatesListPage() {
  const groups = await listIncentiveRates();

  const t = labels.incentiveRate;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground text-sm">{t.listTitle}</p>
        </div>
        <Button asChild>
          <Link href="/masters/incentive-rates/new">{t.new}</Link>
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
          <Button asChild className="mt-4">
            <Link href="/masters/incentive-rates/new">{t.new}</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section
              key={g.relationshipId}
              className="border-border space-y-3 rounded-md border p-4"
            >
              <header className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{g.dealerName}</h2>
                <div className="text-sm">
                  {g.current ? (
                    <span>
                      <span className="text-muted-foreground">{t.currentRate}: </span>
                      <span className="font-medium">
                        {g.current.rate}% ({t.targetTypes[g.current.targetType]})
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t.noCurrentRate}</span>
                  )}
                </div>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t.fields.targetType}</th>
                      <th className="px-3 py-2 font-medium">{t.fields.rate}</th>
                      <th className="px-3 py-2 font-medium">{t.fields.effectiveFrom}</th>
                      <th className="px-3 py-2 font-medium">{t.fields.effectiveTo}</th>
                      <th className="px-3 py-2 font-medium">{c.active}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rates.map((r) => (
                      <tr key={r.id} className="border-border border-t">
                        <td className="px-3 py-2">
                          <Link
                            href={`/masters/incentive-rates/${r.id}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {t.targetTypes[r.targetType]}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{r.rate}%</td>
                        <td className="px-3 py-2">
                          {new Date(r.effectiveFrom).toLocaleDateString("ja-JP")}
                        </td>
                        <td className="px-3 py-2">
                          {r.effectiveTo
                            ? new Date(r.effectiveTo).toLocaleDateString("ja-JP")
                            : "—"}
                        </td>
                        <td className="px-3 py-2">{r.isCurrent ? c.active : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
