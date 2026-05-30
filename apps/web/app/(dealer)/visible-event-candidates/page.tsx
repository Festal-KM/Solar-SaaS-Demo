import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import {
  listActiveWholesalersForDealer,
  listVisibleEventCandidatesForDealer,
  type DealerEventCandidateListItem,
} from "./data";

// S-059 — 二次店向けイベント候補閲覧 (T-03-05 / F-020 / docs/04 §1.5).
//
// 二次店メンバ (dealer_admin / dealer_staff) のみアクセス可。data.ts で
// `assertCan('event_candidate.read_for_dealer')` → wholesaler ロールは 403。
// RLS と `EventCandidateVisibility.isVisible=true` フィルタで自社関係配下の
// 公開中候補のみ返す。固定費 / 成果報酬率 / 内部メモは DTO 物理除外（DOM
// にも JSON にも出ない）。

export const dynamic = "force-dynamic";

function coerceTargetMonth(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
}

function coerceWholesalerId(value: string | undefined): string | undefined {
  // Free-form string id — only validates "presence". 不正な id は data.ts 側で
  // RLS / Relationship 照合により自然に 0 件になる。
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

interface PageProps {
  searchParams: Promise<{ targetMonth?: string; wholesalerId?: string }>;
}

// 月別グルーピング: 対象年月 (YYYY-MM) でまとめて表示する。
// 候補は data.ts 側で `targetMonth ASC, scheduledDate ASC` でソート済み。
function groupByTargetMonth(
  rows: DealerEventCandidateListItem[],
): Array<{ targetMonth: string; rows: DealerEventCandidateListItem[] }> {
  const groups = new Map<string, DealerEventCandidateListItem[]>();
  for (const r of rows) {
    const list = groups.get(r.targetMonth);
    if (list) {
      list.push(r);
    } else {
      groups.set(r.targetMonth, [r]);
    }
  }
  return Array.from(groups.entries()).map(([targetMonth, rows]) => ({ targetMonth, rows }));
}

export default async function DealerEventCandidatesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const targetMonth = coerceTargetMonth(params.targetMonth);
  const wholesalerId = coerceWholesalerId(params.wholesalerId);

  const [rows, wholesalers] = await Promise.all([
    listVisibleEventCandidatesForDealer({
      ...(targetMonth ? { targetMonth } : {}),
      ...(wholesalerId ? { wholesalerId } : {}),
    }),
    listActiveWholesalersForDealer(),
  ]);

  const t = labels.eventCandidateDealer;
  const c = labels.common;
  const groups = groupByTargetMonth(rows);
  const now = Date.now();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.subtitle}</p>
      </div>

      <form method="get" className="flex max-w-2xl flex-wrap items-center gap-2">
        <Input
          type="text"
          name="targetMonth"
          defaultValue={targetMonth ?? ""}
          placeholder="2026-06"
          aria-label={t.filterByTargetMonth}
          className="max-w-[180px]"
        />
        {wholesalers.length > 1 ? (
          <select
            name="wholesalerId"
            defaultValue={wholesalerId ?? ""}
            aria-label={t.filterByWholesaler}
            className="border-input bg-background flex h-10 rounded-md border px-3 py-2 text-sm"
          >
            <option value="">{t.allWholesalers}</option>
            {wholesalers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        ) : null}
        <Button type="submit" variant="outline">
          {c.search}
        </Button>
      </form>

      {groups.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.targetMonth} className="space-y-3">
              <h2 className="text-foreground text-lg font-semibold tracking-tight">
                {t.monthGroupPrefix}
                {group.targetMonth}
              </h2>
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.rows.map((r) => {
                  const deadlinePassed = new Date(r.deadlineAt).getTime() < now;
                  return (
                    <li
                      key={r.id}
                      className="border-border bg-card flex flex-col gap-2 rounded-md border p-4"
                    >
                      <div className="text-muted-foreground text-xs">
                        {t.fields.wholesaler}: {r.wholesalerName ?? "—"}
                      </div>
                      <div className="text-foreground text-base font-medium">{r.storeName}</div>
                      <div className="text-muted-foreground text-sm">
                        <span className="font-medium">{t.fields.scheduledDate}:</span>{" "}
                        {new Date(r.scheduledDate).toLocaleDateString("ja-JP")}
                      </div>
                      {r.area ? (
                        <div className="text-muted-foreground text-sm">
                          <span className="font-medium">{t.fields.area}:</span> {r.area}
                        </div>
                      ) : null}
                      {r.address ? (
                        <div className="text-muted-foreground text-sm">
                          <span className="font-medium">{t.fields.address}:</span> {r.address}
                        </div>
                      ) : null}
                      <div
                        className={
                          deadlinePassed
                            ? "text-destructive text-sm font-medium"
                            : "text-foreground text-sm"
                        }
                      >
                        <span className="font-medium">{t.fields.deadlineAt}:</span>{" "}
                        {new Date(r.deadlineAt).toLocaleString("ja-JP")}
                        {deadlinePassed ? `（${t.deadlinePassed}）` : ""}
                      </div>
                      <div className="mt-2">
                        {/* T-03-06 の希望提出 URL。dealer URL prefix は
                          `/visible-event-candidates` (T-03-05 設計メモ)。
                          T-03-06 の page は `(dealer)/visible-event-candidates/[id]/preference/page.tsx`
                          に置く想定。 */}
                        <Button asChild size="sm" disabled={deadlinePassed}>
                          <Link href={`/visible-event-candidates/${r.id}/preference`}>
                            {t.submitPreference}
                          </Link>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
