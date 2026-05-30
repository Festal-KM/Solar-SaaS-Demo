// Zod schemas for the dealer commission-rate settings (S-049 / F-049 §手数料設定).
//
// `DealerCommissionRate` は二次店ごとに「トスアップ率（紹介のみ）」と
// 「クロージング率（契約完了まで）」の 2 種を保持する。`IncentiveRate`
// （粗利ベース）とは別概念で 1 relationship につき 1 件（@unique）。
//
// このスキーマは「設定画面の保存」専用 — relationshipId に対する upsert。
// rate は JS number で受ける（UI 側で % 文字列を Number() してから送る）。
// applyFrom / applyTo は `YYYY-MM-DD` 文字列で受け、Server Action 側で Date に
// 変換する（time-zone shift を避けるため）。

import { z } from "zod";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD 形式で指定してください");

export const DealerCommissionRateUpdateSchema = z.object({
  relationshipId: z.string().min(1, "関係を指定してください"),
  tossUpRate: z
    .number({ invalid_type_error: "数値を入力してください" })
    .min(0, "0 以上の値を入力してください")
    .max(100, "100 以下の値を入力してください"),
  closingRate: z
    .number({ invalid_type_error: "数値を入力してください" })
    .min(0, "0 以上の値を入力してください")
    .max(100, "100 以下の値を入力してください"),
  applyFrom: dateString,
  applyTo: dateString.nullable().optional(),
});

export type DealerCommissionRateUpdateInput = z.infer<typeof DealerCommissionRateUpdateSchema>;
