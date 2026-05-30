// S-060 — 二次店希望店舗回答 (T-03-06 / F-021 / docs/04 §1.5).
//
// 公開中の特定 EventCandidate に対して、自社の希望内容を新規提出 / 更新 /
// 取り下げするフォーム画面。
//
// アクセス制御:
//   - dealer roles のみ (data.ts の assertCan('dealer_preference.read'))。
//   - 当該候補が自社向けに公開済み (EventCandidateVisibility.isVisible=true) で
//     ない場合は NotFoundError → notFound() で 404 表示。

import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { NotFoundError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";

import { getEventCandidateForPreference } from "./data";
import { PreferenceForm } from "./preference-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DealerPreferencePage({ params }: PageProps) {
  const { id } = await params;
  const t = labels.dealerPreference;
  const c = labels.common;
  const dealerListTitle = labels.eventCandidateDealer.title;

  let loaded;
  try {
    loaded = await getEventCandidateForPreference(id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    throw err;
  }

  const { candidate, existing, relationshipId } = loaded;

  // 期限超過と候補ステータスから disabled を決定する。サーバ側でも再検証する
  // ので、ここの判定は UX 用のみ。
  //
  // data.ts は status=OPEN 以外 (CLOSED/DECIDED/CANCELLED) も visibility=true で
  // 読み込み得るため、ここで status を見て disabled を制御する。優先順位は
  // 期限超過 > status NOT OPEN（期限超過の方が回復不能なため文言を優先）。
  const deadlinePassed = candidate.deadlinePassed;
  const candidateNotOpen = candidate.status !== "OPEN";
  const formDisabled = deadlinePassed || candidateNotOpen;
  const disabledReason = deadlinePassed
    ? t.deadlinePassedBanner
    : candidateNotOpen
      ? t.candidateClosedBanner
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.subtitle}</p>
      </div>

      <section className="border-border bg-card space-y-2 rounded-md border p-4">
        <h2 className="text-foreground text-base font-semibold">{t.candidateHeader}</h2>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <dt className="text-muted-foreground">{t.wholesalerLine}</dt>
          <dd>{candidate.wholesalerName ?? "—"}</dd>
          <dt className="text-muted-foreground">{t.targetMonthLine}</dt>
          <dd>{candidate.targetMonth}</dd>
          <dt className="text-muted-foreground">{t.scheduledDateLine}</dt>
          <dd>{new Date(candidate.scheduledDate).toLocaleDateString("ja-JP")}</dd>
          <dt className="text-muted-foreground">{t.storeNameLine}</dt>
          <dd>{candidate.storeName}</dd>
          {candidate.area ? (
            <>
              <dt className="text-muted-foreground">{t.areaLine}</dt>
              <dd>{candidate.area}</dd>
            </>
          ) : null}
          {candidate.address ? (
            <>
              <dt className="text-muted-foreground">{t.addressLine}</dt>
              <dd>{candidate.address}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{t.deadlineLine}</dt>
          <dd className={deadlinePassed ? "text-destructive font-medium" : undefined}>
            {new Date(candidate.deadlineAt).toLocaleString("ja-JP")}
          </dd>
        </dl>
      </section>

      {existing ? (
        <section className="border-border bg-muted/20 space-y-2 rounded-md border p-4">
          <h2 className="text-foreground text-base font-semibold">{t.existingHeader}</h2>
          <p className="text-muted-foreground text-xs">
            {t.submittedAtLabel}: {new Date(existing.submittedAt).toLocaleString("ja-JP")}
          </p>
        </section>
      ) : (
        <p className="text-muted-foreground text-sm">{t.notSubmittedYet}</p>
      )}

      <section className="space-y-3">
        <h2 className="text-foreground text-base font-semibold">{t.formHeader}</h2>
        <PreferenceForm
          eventCandidateId={candidate.id}
          relationshipId={relationshipId}
          targetMonth={candidate.targetMonth}
          existing={existing}
          disabled={formDisabled}
          disabledReason={disabledReason}
        />
      </section>

      <div>
        <Button asChild variant="outline">
          <a href="/visible-event-candidates">
            {c.back} ({dealerListTitle})
          </a>
        </Button>
      </div>
    </div>
  );
}
