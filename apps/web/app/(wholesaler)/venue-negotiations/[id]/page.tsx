import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { labels } from "@/lib/i18n/labels";

import { getVenueNegotiation, listActiveVenueProviders } from "../data";
import { PromoteForm } from "../promote-form";
import { StatusControl } from "../status-control";
import { VenueNegotiationForm } from "../venue-negotiation-form";

// S-022 — 場所提供元対応 詳細・対応履歴.
//
// 表示要素:
//   - 概要 (場所提供元・現在ステータス・確定日)
//   - 編集フォーム (基本情報・契約条件・条件メモ・備考)
//   - ステータス遷移ボタン
//   - 履歴タイムライン (note の改行区切り)
//   - 「イベント候補に昇格」フォーム (FIXED ステータス時のみ active)

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VenueNegotiationDetailPage({ params }: PageProps) {
  const { id } = await params;
  const row = await getVenueNegotiation(id);
  if (!row) {
    notFound();
  }
  const venueProviders = await listActiveVenueProviders();

  const t = labels.venueNegotiation;
  const c = labels.common;
  const bc = labels.breadcrumb.items;

  const historyLines = (row.note ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: bc.venueNegotiations, href: "/venue-negotiations" },
          { label: bc.venueNegotiationDetail },
        ]}
      />
      <div>
        <Link
          href="/venue-negotiations"
          className="text-sm text-pewter hover:text-carbon-dark flex items-center gap-1 mb-4"
        >
          ← {c.back}
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-medium text-carbon-dark">{t.detailTitle}</h1>
            <p className="text-pewter text-sm mt-1">
              {row.venueProviderName}
              {row.venueProviderArea ? `（${row.venueProviderArea}）` : ""}
            </p>
          </div>
        </div>
      </div>

      <dl className="border border-cloud-gray bg-white rounded-lg p-6 grid grid-cols-1 gap-y-3 sm:grid-cols-3">
        <div>
          <dt className="text-pewter text-xs">{t.fields.status}</dt>
          <dd className="text-carbon-dark text-lg font-medium mt-1">{t.statuses[row.status]}</dd>
        </div>
        <div>
          <dt className="text-pewter text-xs">{t.fields.decidedDate}</dt>
          <dd className="text-carbon-dark text-sm mt-1">
            {row.decidedDate ? new Date(row.decidedDate).toLocaleDateString("ja-JP") : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-pewter text-xs">{t.fields.nextAction}</dt>
          <dd className="text-carbon-dark text-sm mt-1">{row.nextAction ?? "—"}</dd>
        </div>
      </dl>

      <section className="space-y-4" aria-label={t.sections.status}>
        <h2 className="text-lg font-medium text-carbon-dark border-b border-cloud-gray pb-2">{t.sections.status}</h2>
        <StatusControl id={row.id} current={row.status} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-carbon-dark border-b border-cloud-gray pb-2">{t.sections.basic}</h2>
        <VenueNegotiationForm
          mode={{
            kind: "edit",
            id: row.id,
            initial: {
              venueProviderId: row.venueProviderId,
              candidateDates: row.candidateDates,
              contractType: row.contractType ?? undefined,
              fixedFee: row.fixedFee ?? undefined,
              performanceRate: row.performanceRate ?? undefined,
              conditionNote: row.conditionNote ?? undefined,
              nextAction: row.nextAction ?? undefined,
              note: row.note ?? undefined,
            },
          }}
          venueProviders={venueProviders}
        />
      </section>

      <section className="space-y-3" aria-label={t.sections.history}>
        <h2 className="text-lg font-medium text-carbon-dark border-b border-cloud-gray pb-2">{t.sections.history}</h2>
        {historyLines.length === 0 ? (
          <p className="text-pewter text-sm">{t.timeline.empty}</p>
        ) : (
          <ol className="border-cloud-gray space-y-2 border-l pl-4">
            {historyLines.map((line, idx) => (
              <li key={idx} className="text-graphite text-sm">
                <span className="text-pewter">•</span> {line}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-4" aria-label={t.sections.promote}>
        <h2 className="text-lg font-medium text-carbon-dark border-b border-cloud-gray pb-2">{t.sections.promote}</h2>
        <PromoteForm
          id={row.id}
          status={row.status}
          defaultStoreName={row.venueProviderName}
          defaultArea={row.venueProviderArea}
        />
      </section>
    </div>
  );
}
