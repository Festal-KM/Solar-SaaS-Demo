import Link from "next/link";
import { notFound } from "next/navigation";

import { labels } from "@/lib/i18n/labels";

import { getPlanDetail } from "../data";
import { PlanUpdateForm } from "../plan-update-form";

// S-016 詳細 — 該当テナントの plan 変更履歴 + 新プラン適用フォーム。

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ tenantId: string }>;
}

export default async function PlanDetailPage({ params }: PageProps) {
  const { tenantId } = await params;
  const detail = await getPlanDetail(tenantId);
  if (!detail) {
    notFound();
  }

  const t = labels.saasAdminPlan;
  const tt = labels.saasAdminTenant;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/plans"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          ← {t.backToList}
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{detail.name}</h1>
        <span className="text-muted-foreground text-sm">{tt.statuses[detail.status]}</span>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t.sections.current}</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.type}</dt>
            <dd>{tt.types[detail.type]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.currentPlan}</dt>
            <dd>{detail.plan ? tt.plans[detail.plan] : c.notSet}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t.sections.apply}</h2>
        <p className="text-muted-foreground text-xs">{t.notices.noOp}</p>
        <PlanUpdateForm tenantId={detail.id} currentPlan={detail.plan} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t.sections.history}</h2>
        {detail.history.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.noHistory}</p>
        ) : (
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.fields.changedAt}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.planBefore}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.planAfter}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.effectiveFrom}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.note}</th>
                </tr>
              </thead>
              <tbody>
                {detail.history.map((h) => (
                  <tr key={h.id} className="border-border border-t">
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {new Date(h.createdAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {h.planBefore ? tt.plans[h.planBefore] : c.notSet}
                    </td>
                    <td className="px-3 py-2">{tt.plans[h.planAfter]}</td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {new Date(h.effectiveFrom).toLocaleDateString("ja-JP")}
                    </td>
                    <td className="px-3 py-2 text-xs">{h.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
