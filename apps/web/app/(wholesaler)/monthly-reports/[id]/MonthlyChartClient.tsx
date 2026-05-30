"use client";

// Recharts bar chart for S-049 月次報告詳細 — 直近 6 ヶ月の時系列推移.
// Rendered as a client component because Recharts relies on browser APIs.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { labels } from "@/lib/i18n/labels";

interface HistoryPoint {
  targetMonth: string;
  totalSales: number;
  totalGrossProfit: number;
  totalIncentive: number;
}

interface Props {
  history: HistoryPoint[];
}

export function MonthlyChartClient({ history }: Props) {
  const t = labels.monthlyReport;

  if (history.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t.noAggregated}</p>
    );
  }

  const formatted = history.map((h) => ({
    month: h.targetMonth,
    [t.chartLabels.totalSales]: Math.round(h.totalSales),
    [t.chartLabels.totalGrossProfit]: Math.round(h.totalGrossProfit),
    [t.chartLabels.totalIncentive]: Math.round(h.totalIncentive),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={formatted} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `${(v / 10000).toFixed(0)}${t.chartAxisUnit}`}
        />
        <Tooltip
          formatter={(value: number, name: string) => [
            `${value.toLocaleString("ja-JP")} ${t.currencySuffix}`,
            name,
          ]}
        />
        <Legend />
        <Bar dataKey={t.chartLabels.totalSales} fill="#60a5fa" />
        <Bar dataKey={t.chartLabels.totalGrossProfit} fill="#34d399" />
        <Bar dataKey={t.chartLabels.totalIncentive} fill="#f59e0b" />
      </BarChart>
    </ResponsiveContainer>
  );
}
