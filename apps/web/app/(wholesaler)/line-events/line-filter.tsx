"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import type { ActiveVenueProviderOption } from "./data";

const SELECT_CLASS =
  "flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm";

interface LineFilterProps {
  venueProviders: ActiveVenueProviderOption[];
  currentMonth: string;
  currentVenueProviderId: string;
}

export function LineFilter({
  venueProviders,
  currentMonth,
  currentVenueProviderId,
}: LineFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = labels.lineEvent;

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/line-events?${params.toString()}`);
    },
    [searchParams, router],
  );

  const clearFilters = useCallback(() => {
    router.push("/line-events");
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
        <label className="text-xs text-mute-light font-medium">{t.filter.venueProvider}</label>
        <select
          value={currentVenueProviderId}
          onChange={(e) => updateParam("venueProviderId", e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t.filter.allVenueProviders}</option>
          {venueProviders.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
        {t.filter.clear}
      </Button>

      <div className="ml-auto">
        <Button type="button" variant="outline" size="sm" disabled>
          {t.csvExport}
        </Button>
      </div>
    </div>
  );
}
