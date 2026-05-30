// Zod schemas for the installer master (F-013 / docs/05 §3.3 / T-02-05).
//
// 施工業者マスタは「名称必須」「論理停止のみ」「過去契約からの参照は保持」
// （docs/02 §F-013 受け入れ基準）。フィールドは name のみ必須、他は全 optional。
// 物理削除は不可なので、ここに `delete` スキーマは持たない（Server Action 側で
// `disable` = `isActive=false` フリップを行う）。
//
// `VenueProviderInputSchema` と同じく optional な文字列は trim + 空文字 →
// undefined に正規化し、Prisma へそのまま渡せる形にする。

import { z } from "zod";

const optionalNonEmpty = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalEmail = z
  .union([z.literal(""), z.string().email("メールアドレスの形式が正しくありません")])
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const baseShape = {
  name: z.string().trim().min(1, "名称を入力してください").max(255),
  area: optionalNonEmpty,
  phone: optionalNonEmpty,
  email: optionalEmail,
  contactName: optionalNonEmpty,
  isActive: z.boolean().optional(),
};

export const InstallerInputSchema = z.object(baseShape);
export type InstallerInput = z.infer<typeof InstallerInputSchema>;

// Update schema — every field becomes optional. `name`, when present, still
// rejects empty strings so 「名称必須」はパッチ経由で破られない（docs/02 §F-013）。
export const InstallerUpdateSchema = z.object({
  name: baseShape.name.optional(),
  area: baseShape.area,
  phone: baseShape.phone,
  email: baseShape.email,
  contactName: baseShape.contactName,
  isActive: baseShape.isActive,
});
export type InstallerUpdate = z.infer<typeof InstallerUpdateSchema>;
