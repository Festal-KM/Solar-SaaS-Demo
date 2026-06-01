import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { labels } from "@/lib/i18n/labels";

import { getVenueNegotiation, listActiveVenueProviders } from "../data";
import { StatusControl } from "../status-control";
import { VenueNegotiationForm } from "../venue-negotiation-form";

// S-022 — 場所提供元対応 詳細.
//
// 表示要素:
//   - ヘッダ (場所提供元名 + 現在ステータス pill (クリックで変更プルダウン))
//   - 編集フォーム (場所提供元 / 店舗名 / 実施日 / 住所 / 契約形態 + 動的金額 / 備考)

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-medium text-carbon-dark">
              {row.venueProviderName}
            </h1>
            {row.venueProviderArea ? (
              <p className="text-pewter text-sm mt-1">{row.venueProviderArea}</p>
            ) : null}
          </div>
          <StatusControl id={row.id} current={row.status} />
        </div>
      </div>

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
    </div>
  );
}
