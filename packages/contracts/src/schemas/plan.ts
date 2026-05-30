// Zod schemas for SaaS-admin plan management (F-005 / docs/05 §3.2 §4.3 / T-02-09).
//
// プラン変更の入力スキーマ。Tenant.plan enum は schema.prisma で
// `PILOT|SMALL|MEDIUM|LARGE` と定義済み。タスク仕様には CUSTOM 値が記載されるが、
// 現行 Prisma enum には CUSTOM が存在しないため、フォーム側は SMALL/MEDIUM/LARGE
// （+ シード由来の PILOT）を提示し、CUSTOM は将来拡張余地として `note` に
// 自由記述してもらう運用に倒す（schema 拡張は後続スプリント）。
//
// `effectiveFrom` を持たせる理由: 実運用ではプラン変更を「来月 1 日から適用」
// のような未来日付で予約することがある。本タスクでは記録するだけで、適用判定の
// バッチは実装しない（即時適用）。記録は監査ログの一部として残る。

import { z } from "zod";

// docs/04 §S-016 で語られる規模感（小/中/大）。`SMALL`/`MEDIUM`/`LARGE` を新規
// 選択可、`PILOT` はシード起源のため新規プラン変更先としては受け付けない（運用上
// パイロット契約は SaaS 開発者のみが付与する位置付け）。
export const SelectablePlanSchema = z.enum(["SMALL", "MEDIUM", "LARGE"]);
export type SelectablePlanValue = z.infer<typeof SelectablePlanSchema>;

const optionalNote = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalDate = z
  .union([z.string(), z.date()])
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    if (v instanceof Date) return v;
    const trimmed = v.trim();
    if (trimmed.length === 0) return undefined;
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ["effectiveFrom"],
          message: "適用開始日の形式が正しくありません",
        },
      ]);
    }
    return d;
  });

export const UpdatePlanSchema = z.object({
  tenantId: z.string().trim().min(1, "テナント ID を指定してください"),
  plan: SelectablePlanSchema,
  effectiveFrom: optionalDate,
  note: optionalNote,
});
export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;
