// レーン一覧 — F-059. 場所ごとのレーン契約情報を月単位で一覧表示する。

import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

import {
  listActiveAreas,
  listActiveDealers,
  listActiveStores,
  listActiveVenueProviders,
  listLineEvents,
  listWholesalerUsers,
} from "./data";
import { LineFilter } from "./line-filter";
import { LineTable } from "./line-table";
import { NewLineEventDialog } from "./new-line-event-dialog";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ month?: string; venueProviderId?: string }>;
}

// 当月を YYYY-MM で算出（タイムゾーン安全に getFullYear/getMonth で）。
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function LineEventsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const t = labels.lineEvent;

  const targetMonth =
    params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : currentMonth();
  const venueProviderId = params.venueProviderId ?? "";

  const [rows, venueProviders, areas, stores, wholesalerUsers, dealers] = await Promise.all([
    listLineEvents({ targetMonth, venueProviderId: venueProviderId || undefined }),
    listActiveVenueProviders(),
    listActiveAreas(),
    listActiveStores(),
    listWholesalerUsers(),
    listActiveDealers(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t.title}</h1>
          <p className="text-body-light text-sm mt-1">{t.subtitle}</p>
        </div>
        <NewLineEventDialog
          venueProviders={venueProviders}
          areas={areas}
          stores={stores}
          wholesalerUsers={wholesalerUsers}
          dealers={dealers}
          defaultMonth={targetMonth}
        />
      </div>

      <Card className="p-4">
        <LineFilter
          venueProviders={venueProviders}
          currentMonth={targetMonth}
          currentVenueProviderId={venueProviderId}
        />
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline-light">
          <h2 className="text-sm font-medium text-ink">{t.title}</h2>
          <span className="text-xs text-mute-light tabular-nums">
            {rows.length}
            {t.filter.resultCount}
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-mute-light text-sm">{t.empty}</div>
        ) : (
          <LineTable rows={rows} />
        )}
      </Card>
    </div>
  );
}
