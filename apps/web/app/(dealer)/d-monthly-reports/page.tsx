// S-068 — 二次店 月次報告一覧・コメント提出 (T-06-08 / F-049 / docs/04 §1.5).
//
// 二次店ロール (dealer_admin) が自社の月次報告を一覧し、DRAFT 状態の報告に
// コメントを入力して提出するページ。
// 権限: monthly_report.read → DEALER_ADMIN / DEALER_STAFF
//      monthly_report.submit_comments → DEALER_ADMIN

import "server-only";

import { labels } from "@/lib/i18n/labels";

import { listDealerMonthlyReports } from "./data";
import { SubmitCommentForm } from "./submit-comment-form";

export const dynamic = "force-dynamic";

export default async function DealerMonthlyReportsPage() {
  const result = await listDealerMonthlyReports();

  const t = labels.monthlyReport;
  const td = labels.monthlyReport.dealerList;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{td.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{td.subtitle}</p>
      </div>

      {result.items.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{td.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{td.emptyCta}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {result.items.map((report) => {
            const commentsObj =
              report.commentsRaw && typeof report.commentsRaw === "object"
                ? (report.commentsRaw as Record<string, string>)
                : {};

            return (
              <div key={report.id} className="border-border rounded-md border p-4 space-y-4">
                {/* Report header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="font-medium tabular-nums">{report.targetMonth}</p>
                    <p className="text-muted-foreground text-xs">
                      {t.scopes[report.scope] ?? report.scope}
                    </p>
                  </div>
                  <span className={t.statusBadgeClass[report.status] ?? "text-foreground"}>
                    {t.statuses[report.status] ?? report.status}
                  </span>
                </div>

                {/* Existing comments (SUBMITTED / REVIEWED / FINALIZED) */}
                {report.status !== "DRAFT" && (
                  <div className="space-y-2 text-sm">
                    {(
                      [
                        ["mainResults", t.comment.fields.mainResults],
                        ["issues", t.comment.fields.issues],
                        ["improvements", t.comment.fields.improvements],
                        ["nextMonthFocusStores", t.comment.fields.nextMonthFocusStores],
                        ["nextMonthMeasures", t.comment.fields.nextMonthMeasures],
                        ["dealerComment", t.comment.fields.dealerComment],
                      ] as [string, string][]
                    ).map(([key, label]) =>
                      commentsObj[key] ? (
                        <div key={key}>
                          <dt className="text-muted-foreground text-xs">{label}</dt>
                          <dd className="whitespace-pre-wrap">{commentsObj[key]}</dd>
                        </div>
                      ) : null,
                    )}

                    {commentsObj["reviewComment"] && (
                      <div className="border-t pt-2">
                        <dt className="text-muted-foreground text-xs">
                          {t.comment.wholesalerCommentLabel}
                        </dt>
                        <dd className="whitespace-pre-wrap">{commentsObj["reviewComment"]}</dd>
                      </div>
                    )}
                  </div>
                )}

                {/* Comment input form — only for DRAFT reports */}
                {report.status === "DRAFT" && (
                  <SubmitCommentForm reportId={report.id} />
                )}

                {report.status === "FINALIZED" && (
                  <p className="text-xs text-muted-foreground">{t.comment.finalized}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
