// Zod schemas for the area master (エリアマスタ).
//
// エリアは「名称必須」「論理停止のみ」のシンプルなマスタ。イベント候補登録時の
// エリア選択肢として使う。Installer マスタと同じく optional フィールドは
// trim + 空文字 → undefined に正規化する。物理削除は持たない（Server Action
// 側で `disable` = `isActive=false` フリップ）。

import { z } from "zod";

const baseShape = {
  name: z.string().trim().min(1, "名称を入力してください").max(255),
  isActive: z.boolean().optional(),
};

export const AreaInputSchema = z.object(baseShape);
export type AreaInput = z.infer<typeof AreaInputSchema>;

export const AreaUpdateSchema = z.object({
  name: baseShape.name.optional(),
  isActive: baseShape.isActive,
});
export type AreaUpdate = z.infer<typeof AreaUpdateSchema>;
