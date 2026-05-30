// S-027 — イベント開催体制決定 (T-03-08 / F-023 / docs/04 §1.3 S-027).
//
// 卸業者本部 (wholesaler_admin / wholesaler_event_team) 専用。
// RSC で候補情報・関係一覧・希望状況を取得し、Client Component の
// `EventDecisionForm` に渡す。認可は data.ts の requireDecideCtx で担う。

import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { getEventDecidePageData } from "./data";
import { EventDecisionForm } from "./event-decision-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EventDecidePage({ params }: PageProps) {
  const { id } = await params;

  let data;
  try {
    data = await getEventDecidePageData(id);
  } catch {
    notFound();
  }

  const { candidate, relationships } = data;
  const t = labels.eventDecision;
  const ec = labels.eventCandidate;

  const allowedStatuses = ["OPEN", "CLOSED"];
  if (!allowedStatuses.includes(candidate.status)) {
    notFound();
  }

  const bc = labels.breadcrumb.items;

  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: bc.eventCandidates, href: "/events" },
          { label: bc.eventCandidateDetail, href: `/event-detail/${candidate.id}` },
          { label: bc.eventCandidateDecide },
        ]}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground text-sm">{t.subtitle}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/event-detail/${candidate.id}`}>{t.backToCandidate}</Link>
        </Button>
      </div>

      <section
        className="border-border bg-muted/20 grid grid-cols-1 gap-4 rounded-md border p-4 sm:grid-cols-4"
        aria-label={t.candidateInfo}
      >
        <div>
          <p className="text-muted-foreground text-xs">{ec.fields.storeName}</p>
          <p className="text-lg font-semibold">{candidate.storeName}</p>
          {candidate.area ? (
            <p className="text-muted-foreground text-xs">{candidate.area}</p>
          ) : null}
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{ec.fields.targetMonth}</p>
          <p className="text-lg font-semibold">{candidate.targetMonth}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{ec.fields.scheduledDate}</p>
          <p className="text-sm">
            {new Date(candidate.scheduledDate).toLocaleDateString("ja-JP")}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{ec.fields.status}</p>
          <p className="text-sm font-medium">
            {ec.statuses[candidate.status as keyof typeof ec.statuses] ?? candidate.status}
          </p>
        </div>
      </section>

      <EventDecisionForm
        eventCandidateId={candidate.id}
        relationships={relationships}
      />
    </div>
  );
}
