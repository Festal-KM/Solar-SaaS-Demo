"use client";

// Recharts-based chart components for S-051 BI ダッシュボード.
// Client component because Recharts relies on browser APIs.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { labels } from "@/lib/i18n/labels";

import type { BiTimeSeriesPoint } from "./data";

interface TimeSeriesChartProps {
  timeSeries: BiTimeSeriesPoint[];
}

export function BiTimeSeriesChart({ timeSeries }: TimeSeriesChartProps) {
  const t = labels.bi.chart;

  const data = timeSeries.map((p) => ({
    month: p.targetMonth,
    [t.salesLabel]: Math.round(p.totalSales),
    [t.grossProfitLabel]: Math.round(p.totalGrossProfit),
    [t.contractCountLabel]: p.contractCount,
  }));

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">{labels.bi.empty}</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `${(v / 10_000).toFixed(0)}${t.axisUnit}`}
        />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value: number, name: string) => {
            if (name === t.contractCountLabel) {
              return [`${value.toLocaleString("ja-JP")} ${t.contractCountSuffix}`, name];
            }
            return [`${value.toLocaleString("ja-JP")} ${t.currencySuffix}`, name];
          }}
        />
        <Legend />
        <Bar yAxisId="left" dataKey={t.salesLabel} fill="#60a5fa" />
        <Bar yAxisId="left" dataKey={t.grossProfitLabel} fill="#34d399" />
        <Bar yAxisId="right" dataKey={t.contractCountLabel} fill="#f59e0b" />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface ConversionRateChartProps {
  timeSeries: BiTimeSeriesPoint[];
}

export function BiConversionRateChart({ timeSeries }: ConversionRateChartProps) {
  const t = labels.bi.chart;

  const data = timeSeries
    .filter((p) => p.conversionRate !== null)
    .map((p) => ({
      month: p.targetMonth,
      [t.conversionRateLabel]: p.conversionRate !== null ? Math.round(p.conversionRate * 100) : 0,
    }));

  if (data.length === 0) {
    return null;
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `${v}${t.percentSuffix}`}
          domain={[0, 100]}
        />
        <Tooltip
          formatter={(value: number, name: string) => [
            `${value}${t.percentSuffix}`,
            name,
          ]}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey={t.conversionRateLabel}
          stroke="#a78bfa"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
