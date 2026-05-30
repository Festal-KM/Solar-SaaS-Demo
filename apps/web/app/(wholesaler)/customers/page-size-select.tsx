"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { labels } from "@/lib/i18n/labels";

import { PAGE_SIZE_OPTIONS } from "./constants";

interface PageSizeSelectProps {
  pageSize: number;
}

export function PageSizeSelect({ pageSize }: PageSizeSelectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = labels.customer;

  const onChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("pageSize", value);
      // Changing page size resets to page 1.
      params.delete("page");
      router.push(`/customers?${params.toString()}`);
    },
    [searchParams, router],
  );

  return (
    <select
      value={String(pageSize)}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t.pageSize.label.replace("{n}", String(pageSize))}
      className="h-9 rounded-md border border-hairline-light bg-white px-3 py-1 text-sm text-body-light focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
    >
      {PAGE_SIZE_OPTIONS.map((n) => (
        <option key={n} value={n}>
          {t.pageSize.label.replace("{n}", String(n))}
        </option>
      ))}
    </select>
  );
}
