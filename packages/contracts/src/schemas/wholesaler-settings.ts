// Zod schemas for the wholesaler-settings master (F-015 / F-016 / docs/05 §3.2 /
// T-02-07).
//
// `WholesalerSettings` は卸業者テナント単位の運用ポリシー設定（キャンセル猶予
// 日数 / 年度開始月 / PII マスキングモード）。レコードは Tenant 作成時に既定値
// で自動作成される設計だが、Server Action 側で upsert することで欠損ケースを
// 堅牢化する。
//
// 全フィールドを optional 化（patch セマンティクス）。クライアントは変更したい
// フィールドのみ送信できる。空オブジェクト（何も変更しない）も valid だが、
// 監査ログ的に意味がないので Server Action 側で no-op 判定する余地を残す。
//
// 過去契約への遡及禁止: `cancelDeadlineDays` の変更は将来契約のみに適用される。
// 過去契約は `Contract.cancelDeadline` に契約成立時点の snapshot を保持する
// （SP-05 / T-05 で実装）。本設定の更新は既存 Contract レコードを書き換えない。

import { z } from "zod";

export const PiiMaskingModeSchema = z.enum(["MASKED", "FULL", "PARTIAL"]);
export type PiiMaskingMode = z.infer<typeof PiiMaskingModeSchema>;

// docs/02 §F-015: デフォルト 8 日。上限 90 日（業務的に「キャンセル猶予 3 か月
// 超」は現実離れしている範囲設定として弾く。docs/01 §7.2 の運用想定）。下限 1
// 日（0 はキャンセル不可と等価なので別途運用ルールでカバー）。
const cancelDeadlineDays = z
  .number()
  .int("整数で入力してください")
  .min(1, "1〜90 日の範囲で入力してください")
  .max(90, "1〜90 日の範囲で入力してください");

// docs/02 §F-016: 年度開始月 1..12。
const fiscalYearStartMonth = z
  .number()
  .int("整数で入力してください")
  .min(1, "1〜12 月の範囲で入力してください")
  .max(12, "1〜12 月の範囲で入力してください");

export const WholesalerSettingsUpdateSchema = z.object({
  cancelDeadlineDays: cancelDeadlineDays.optional(),
  fiscalYearStartMonth: fiscalYearStartMonth.optional(),
  piiMaskingMode: PiiMaskingModeSchema.optional(),
});
export type WholesalerSettingsUpdate = z.infer<typeof WholesalerSettingsUpdateSchema>;

// Default values used when a tenant has no WholesalerSettings row yet
// (mirrors `@default` in the Prisma model, docs/05 §3.2). Keep in sync with
// the schema migration.
export const WHOLESALER_SETTINGS_DEFAULTS = {
  cancelDeadlineDays: 8,
  fiscalYearStartMonth: 4,
  piiMaskingMode: "MASKED" as PiiMaskingMode,
} as const;
