// Zod schemas for the area master (エリアマスタ).
//
// エリアは「名称必須」「論理停止のみ」のシンプルなマスタ。イベント候補登録時の
// エリア選択肢として使う。Installer マスタと同じく optional フィールドは
// trim + 空文字 → undefined に正規化する。物理削除は持たない（Server Action
// 側で `disable` = `isActive=false` フリップ）。

import { z } from "zod";

// イベント開催エリア（EVENT）と顧客エリア（CUSTOMER）の区別。Area マスタの
// type 列と 1:1 対応。マイグレーション初期値は EVENT。
export const AreaTypeSchema = z.enum(["EVENT", "CUSTOMER"]);
export type AreaTypeValue = z.infer<typeof AreaTypeSchema>;

const baseShape = {
  name: z.string().trim().min(1, "名称を入力してください").max(255),
  type: AreaTypeSchema.default("EVENT"),
  // 補助メモ (運用ルール / 対象市区町村 等)。null は明示クリア、undefined は
  // 「変更しない」(Update 側の挙動)。
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
};

export const AreaInputSchema = z.object(baseShape);
export type AreaInput = z.infer<typeof AreaInputSchema>;

export const AreaUpdateSchema = z.object({
  name: baseShape.name.optional(),
  type: AreaTypeSchema.optional(),
  description: baseShape.description,
  isActive: baseShape.isActive,
});
export type AreaUpdate = z.infer<typeof AreaUpdateSchema>;
