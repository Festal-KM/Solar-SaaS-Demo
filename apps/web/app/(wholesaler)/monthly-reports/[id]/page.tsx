// S-049 — 卸業者 月次報告詳細・確定 (T-06-07 / T-06-08 / T-06-09 / F-048 / F-049 / F-050 / docs/04 §1.3).
//
// 集計値の表示 + Recharts 棒グラフ（直近 6 ヶ月）。
// コメント提出・確認は T-06-08 で実装済み。確定 / アンロックは T-06-09 で実装。
// 権限: monthly_report.read → WHOLESALER_ADMIN / WHOLESALER_EVENT_TEAM

import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { listHistoryForScope } from "../data";
import { getMonthlyReportDetail } from "./data";
import { FinalizeReportForm } from "./finalize-form";
import { MonthlyChartClient } from "./MonthlyChartClient";
import { ReviewCommentForm } from "./review-comment-form";
import { UnlockReportForm } from "./unlock-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MonthlyReportDetailPage({ params }: PageProps) {
  const { id } = await params;

  const report = await getMonthlyReportDetail(id);
  if (!report) notFound();

  const historyData = await listHistoryForScope(report.scope, report.relationshipId);

  const t = labels.monthlyReport;
  const tc = labels.monthlyReport.comment;
  const bc = labels.breadcrumb.items;

  // Extract existing comments from aggregatedRaw-adjacent field
  const commentsObj =
    report.commentsRaw && typeof report.commentsRaw === "object"
      ? (report.commentsRaw as Record<string, string>)
      : {};

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.monthlyReports, href: "/monthly-reports" },
          { label: bc.monthlyReportDetail },
        ]}
      />
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/monthly-reports">{t.backToList}</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t.detailTitle}</h1>
      </div>

      {/* Header metadata */}
      <div className="border-border rounded-md border p-4 space-y-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <dt className="text-muted-foreground">{t.fields.targetMonth}</dt>
          <dd className="font-medium tabular-nums">{report.targetMonth}</dd>

          <dt className="text-muted-foreground">{t.fields.scope}</dt>
          <dd>{t.scopes[report.scope] ?? report.scope}</dd>

          <dt className="text-muted-foreground">{t.fields.status}</dt>
          <dd>
            <span className={t.statusBadgeClass[report.status] ?? "text-foreground"}>
              {t.statuses[report.status] ?? report.status}
            </span>
            {report.status === "FINALIZED" && report.finalizedAt && (
              <span className="text-muted-foreground ml-2 text-xs">
                ({new Date(report.finalizedAt).toLocaleDateString("ja-JP")})
              </span>
            )}
          </dd>

          <dt className="text-muted-foreground">{t.fields.updatedAt}</dt>
          <dd className="text-muted-foreground text-xs">
            {new Date(report.updatedAt).toLocaleString("ja-JP")}
          </dd>

          {report.relationshipId && (
            <>
              <dt className="text-muted-foreground">{t.fields.relationshipId}</dt>
              <dd className="text-muted-foreground text-xs">{report.relationshipId}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Aggregated figures */}
      <div className="border-border rounded-md border p-4 space-y-3">
        <h2 className="font-medium">{t.aggregatedSection}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <dt className="text-muted-foreground">{t.fields.contractCount}</dt>
          <dd className="font-medium tabular-nums">
            {report.contractCount.toLocaleString("ja-JP")} {t.countSuffix}
          </dd>

          <dt className="text-muted-foreground">{t.fields.totalSales}</dt>
          <dd className="font-medium tabular-nums">
            {report.totalSales.toLocaleString("ja-JP")} {t.currencySuffix}
          </dd>

          <dt className="text-muted-foreground">{t.fields.totalGrossProfit}</dt>
          <dd className="font-medium tabular-nums">
            {report.totalGrossProfit.toLocaleString("ja-JP")} {t.currencySuffix}
          </dd>

          <dt className="text-muted-foreground">{t.fields.totalIncentive}</dt>
          <dd className="font-medium tabular-nums">
            {report.totalIncentive.toLocaleString("ja-JP")} {t.currencySuffix}
          </dd>

          <dt className="text-muted-foreground">{t.fields.averageProfitRate}</dt>
          <dd className="tabular-nums">
            {(report.averageProfitRate * 100).toFixed(1)} {t.percentSuffix}
          </dd>
        </dl>
      </div>

      {/* Bar chart — last 6 months */}
      <div className="border-border rounded-md border p-4 space-y-3">
        <h2 className="font-medium">{t.chartSection}</h2>
        <MonthlyChartClient history={historyData} />
      </div>

      {/* Comments section */}
      <div className="border-border rounded-md border p-4 space-y-4">
        <h2 className="font-medium">{t.commentsSection}</h2>

        {/* Dealer comment display */}
        {report.status === "DRAFT" ? (
          <p className="text-sm text-muted-foreground">{tc.notSubmittedYet}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground font-medium">{tc.dealerCommentLabel}</p>
            {(
              [
                ["mainResults", tc.fields.mainResults],
                ["issues", tc.fields.issues],
                ["improvements", tc.fields.improvements],
                ["nextMonthFocusStores", tc.fields.nextMonthFocusStores],
                ["nextMonthMeasures", tc.fields.nextMonthMeasures],
                ["dealerComment", tc.fields.dealerComment],
              ] as [string, string][]
            ).map(([key, label]) =>
              commentsObj[key] ? (
                <div key={key}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap">{commentsObj[key]}</dd>
                </div>
              ) : null,
            )}

            {commentsObj["reviewComment"] && (
              <div className="border-t pt-3">
                <p className="text-xs text-muted-foreground font-medium mb-1">
                  {tc.wholesalerCommentLabel}
                </p>
                <p className="whitespace-pre-wrap">{commentsObj["reviewComment"]}</p>
              </div>
            )}
          </div>
        )}

        {/* Review action — wholesaler_admin when status=SUBMITTED */}
        {report.status === "SUBMITTED" && (
          <ReviewCommentForm reportId={report.id} />
        )}
      </div>

      {/* Finalize / Unlock section (T-06-09) */}
      <div className="border-border rounded-md border p-4 space-y-3">
        <h2 className="font-medium">{t.finalizeSection}</h2>

        {report.status === "REVIEWED" && (
          <FinalizeReportForm reportId={report.id} />
        )}

        {report.status === "FINALIZED" && (
          <div className="space-y-4">
            <p className="text-sm text-green-700 font-medium">{t.finalizedBadge}</p>
            <UnlockReportForm reportId={report.id} />
          </div>
        )}

        {report.status !== "REVIEWED" && report.status !== "FINALIZED" && (
          <p className="text-sm text-muted-foreground">{t.notReviewedYet}</p>
        )}
      </div>
    </div>
  );
}
