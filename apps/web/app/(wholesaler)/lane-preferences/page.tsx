// 二次店希望一覧 — F-060. 二次店から提出された月次レーン希望をアコーディオンで一覧表示する。

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

import { listActiveRelationships, listLanePreferences } from "./data";
import { LanePreferenceAccordion } from "./lane-preference-accordion";
import { LanePreferenceFilter } from "./lane-preference-filter";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ month?: string; relationshipId?: string }>;
}

// 当月を YYYY-MM で算出（タイムゾーン安全に getFullYear/getMonth で）。
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function LanePreferencesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const t = labels.lanePreference;

  const targetMonth =
    params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : currentMonth();
  const relationshipId = params.relationshipId ?? "";

  const [rows, relationships] = await Promise.all([
    listLanePreferences({ targetMonth, relationshipId: relationshipId || undefined }),
    listActiveRelationships(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t.title}</h1>
          <p className="text-body-light text-sm mt-1">{t.subtitle}</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled>
          {t.csvExport}
        </Button>
      </div>

      <Card className="p-4">
        <LanePreferenceFilter
          relationships={relationships}
          currentMonth={targetMonth}
          currentRelationshipId={relationshipId}
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
          <LanePreferenceAccordion rows={rows} />
        )}
      </Card>
    </div>
  );
}
