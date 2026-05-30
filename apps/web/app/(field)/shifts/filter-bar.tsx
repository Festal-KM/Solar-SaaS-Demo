"use client";

// ShiftFilterBar — スマホ向け期間フィルタ UI (S-054 / T-03-11).
//
// 「今日」「今週」「期間指定」の 3 モードを切替える。モード変更は URL
// searchParams に書き込み、RSC が再レンダリングする。
// カスタム期間では from / to の <input type="date"> を表示する。

import { useRouter, useSearchParams } from "next/navigation";

import { labels } from "@/lib/i18n/labels";

interface ShiftFilterBarProps {
  currentFilter: string;
  currentFrom: string;
  currentTo: string;
}

export function ShiftFilterBar({ currentFilter, currentFrom, currentTo }: ShiftFilterBarProps) {
  const l = labels.fieldShift.filter;
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(filter: string, from?: string, to?: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("filter", filter);
    if (from) params.set("from", from);
    else params.delete("from");
    if (to) params.set("to", to);
    else params.delete("to");
    router.push(`?${params.toString()}`);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const from = fd.get("from") as string;
    const to = fd.get("to") as string;
    navigate("custom", from, to);
  }

  const btnBase =
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
  const btnActive = "bg-primary text-primary-foreground border-primary";
  const btnInactive =
    "bg-background text-foreground border-border hover:bg-muted";

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          className={`${btnBase} ${currentFilter === "today" ? btnActive : btnInactive}`}
          onClick={() => navigate("today")}
        >
          {l.today}
        </button>
        <button
          type="button"
          className={`${btnBase} ${currentFilter === "week" ? btnActive : btnInactive}`}
          onClick={() => navigate("week")}
        >
          {l.thisWeek}
        </button>
        <button
          type="button"
          className={`${btnBase} ${currentFilter === "custom" ? btnActive : btnInactive}`}
          onClick={() => navigate("custom", currentFrom, currentTo)}
        >
          {l.custom}
        </button>
      </div>

      {currentFilter === "custom" && (
        <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">{l.from}</span>
            <input
              type="date"
              name="from"
              defaultValue={currentFrom}
              className="border-border rounded border px-2 py-1 text-xs"
            />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">{l.to}</span>
            <input
              type="date"
              name="to"
              defaultValue={currentTo}
              className="border-border rounded border px-2 py-1 text-xs"
            />
          </label>
          <button
            type="submit"
            className="bg-primary text-primary-foreground rounded px-3 py-1 text-xs"
          >
            {l.apply}
          </button>
        </form>
      )}
    </div>
  );
}
