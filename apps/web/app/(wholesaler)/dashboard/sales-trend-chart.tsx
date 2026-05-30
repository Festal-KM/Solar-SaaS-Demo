"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface SalesTrendPoint {
  month: string;
  revenue: number;
  grossProfit: number;
}

export function SalesTrendChart({ data }: { data: SalesTrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-pewter text-sm">
        データがありません
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EEEEEE" />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12, fill: "#5C5E62" }}
          axisLine={{ stroke: "#EEEEEE" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 12, fill: "#5C5E62" }}
          axisLine={{ stroke: "#EEEEEE" }}
          tickLine={false}
          tickFormatter={(v: number) => `${(v / 10000).toFixed(0)}万`}
        />
        <Tooltip
          formatter={(value: number, name: string) => [
            `¥${value.toLocaleString("ja-JP")}`,
            name === "revenue" ? "売上" : "粗利",
          ]}
          contentStyle={{
            border: "1px solid #EEEEEE",
            borderRadius: "4px",
            fontSize: "12px",
            boxShadow: "none",
          }}
        />
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="#3E6AE1"
          strokeWidth={2}
          dot={{ r: 3, fill: "#3E6AE1" }}
          name="revenue"
        />
        <Line
          type="monotone"
          dataKey="grossProfit"
          stroke="#393C41"
          strokeWidth={2}
          dot={{ r: 3, fill: "#393C41" }}
          strokeDasharray="4 4"
          name="grossProfit"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
