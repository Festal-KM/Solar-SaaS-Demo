// Zod schemas for the store master (店舗マスタ).
//
// 店舗は「名称必須」「論理停止のみ」のシンプルなマスタ。イベント候補登録時の
// 店舗選択肢として使う。Area マスタと同じく optional フィールドは trim + 空文字
// → undefined に正規化する。物理削除は持たない（Server Action 側で `disable` =
// `isActive=false` フリップ）。

import { z } from "zod";

const baseShape = {
  name: z.string().trim().min(1, "名称を入力してください").max(255),
  isActive: z.boolean().optional(),
};

export const StoreInputSchema = z.object(baseShape);
export type StoreInput = z.infer<typeof StoreInputSchema>;

export const StoreUpdateSchema = z.object({
  name: baseShape.name.optional(),
  isActive: baseShape.isActive,
});
export type StoreUpdate = z.infer<typeof StoreUpdateSchema>;
