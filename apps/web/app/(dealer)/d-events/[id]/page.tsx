// S-062 — イベント詳細（二次店ビュー）(T-04-02 / F-027 / docs/04 §1.5 S-062).
//
// dealer_admin / dealer_staff が自社担当イベントの詳細を確認する画面。
// 仕入値 (purchasePrice) / 卸業者内部情報は表示しない（loader が物理除外）。
// 他社担当イベント ID を直叩きしても NotFoundError → 404 になる。

import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { getDealerEventDetail } from "./data";
import { DealerReportButtons } from "./reports/report-buttons";
import { DealerResultReportForm } from "./reports/result-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DealerEventDetailPage({ params }: PageProps) {
  const { id } = await params;

  let data;
  try {
    data = await getDealerEventDetail(id);
  } catch {
    notFound();
  }

  const t = labels.eventDealer;
  const c = labels.common;

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.eventCandidate.storeName}</h1>
          <p className="text-muted-foreground text-sm">
            {data.eventCandidate.targetMonth} —{" "}
            {new Date(data.eventCandidate.scheduledDate).toLocaleDateString("ja-JP")}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/d-events">{t.backToList}</Link>
        </Button>
      </div>

      {/* Event info */}
      <section
        aria-label={t.sections.info}
        className="border-border bg-muted/20 grid grid-cols-1 gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <p className="text-muted-foreground text-xs">{t.fields.storeName}</p>
          <p className="text-lg font-semibold">{data.eventCandidate.storeName}</p>
          {data.eventCandidate.area ? (
            <p className="text-muted-foreground text-xs">{data.eventCandidate.area}</p>
          ) : null}
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t.fields.wholesaler}</p>
          <p className="text-sm">{data.wholesalerName ?? "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t.fields.mode}</p>
          <p className="text-sm font-medium">{t.modes[data.mode]}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t.fields.status}</p>
          <Badge
            variant={
              data.status === "PLANNED"
                ? "secondary"
                : data.status === "ONGOING"
                  ? "default"
                  : data.status === "CLOSED"
                    ? "outline"
                    : "destructive"
            }
          >
            {t.statuses[data.status]}
          </Badge>
        </div>
        {data.eventCandidate.address ? (
          <div className="sm:col-span-2">
            <p className="text-muted-foreground text-xs">{t.fields.address}</p>
            <p className="text-sm">{data.eventCandidate.address}</p>
          </div>
        ) : null}
      </section>

      {/* Scope */}
      <section aria-label={t.sections.scope}>
        <h2 className="text-base font-semibold mb-3">{t.sections.scope}</h2>
        <p className="text-sm">
          {data.scopeOverride
            ? t.scopes[data.scopeOverride as keyof typeof t.scopes] ?? data.scopeOverride
            : c.notSet}
        </p>
      </section>

      {/* Reports */}
      <section aria-label={t.sections.reports}>
        <h2 className="text-base font-semibold mb-3">{t.sections.reports}</h2>
        {data.reports.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.noReports}</p>
        ) : (
          <ul className="space-y-2">
            {data.reports.map((r) => (
              <li key={r.id} className="border-border rounded-md border p-3 text-sm">
                <span className="font-medium">
                  {t.reportTypes[r.type as keyof typeof t.reportTypes] ?? r.type}
                </span>
                <span className="text-muted-foreground ml-2 text-xs">
                  {new Date(r.createdAt).toLocaleString("ja-JP")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Report actions (T-04-03) */}
      <section aria-label={labels.eventReport.sections.actions}>
        <h2 className="text-base font-semibold mb-3">{labels.eventReport.sections.actions}</h2>
        <DealerReportButtons
          eventId={data.id}
          hasDealerStart={data.reports.some((r) => r.type === "START" && r.reporterOrgType === "DEALER")}
          hasDealerEnd={data.reports.some((r) => r.type === "END" && r.reporterOrgType === "DEALER")}
        />
      </section>

      {/* Result report (T-04-04 / F-030) */}
      <section aria-label={labels.eventReport.sections.result}>
        <h2 className="text-base font-semibold mb-3">{labels.eventReport.sections.result}</h2>
        <DealerResultReportForm
          eventId={data.id}
          hasDealerResult={data.reports.some(
            (r) => r.type === "RESULT" && r.reporterOrgType === "DEALER",
          )}
        />
      </section>
    </div>
  );
}
