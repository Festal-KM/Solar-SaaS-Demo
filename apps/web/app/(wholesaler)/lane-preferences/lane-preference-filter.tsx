"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import type { DealerOption } from "./data";

const SELECT_CLASS = "flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm";

interface LanePreferenceFilterProps {
  relationships: DealerOption[];
  currentMonth: string;
  currentRelationshipId: string;
}

export function LanePreferenceFilter({
  relationships,
  currentMonth,
  currentRelationshipId,
}: LanePreferenceFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = labels.lanePreference;

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/lane-preferences?${params.toString()}`);
    },
    [searchParams, router],
  );

  const clearFilters = useCallback(() => {
    router.push("/lane-preferences");
  }, [router]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label className="text-xs text-mute-light font-medium">{t.filter.month}</label>
        <Input
          type="month"
          value={currentMonth}
          onChange={(e) => updateParam("month", e.target.value)}
          className="h-9 w-[160px]"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-mute-light font-medium">{t.filter.dealer}</label>
        <select
          value={currentRelationshipId}
          onChange={(e) => updateParam("relationshipId", e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t.filter.allDealers}</option>
          {relationships.map((r) => (
            <option key={r.relationshipId} value={r.relationshipId}>
              {r.dealerName}
            </option>
          ))}
        </select>
      </div>

      <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
        {t.filter.clear}
      </Button>
    </div>
  );
}
