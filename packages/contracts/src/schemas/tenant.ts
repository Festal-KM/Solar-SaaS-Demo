// Zod schemas for SaaS-admin tenant management (F-004 / docs/05 §4.3 / T-02-08).
//
// `CreateTenantSchema` is invoked by `createTenantAction` in
// `apps/web/app/(saas-admin)/tenants/actions.ts`. The shape mirrors docs/04
// §S-015 form (テナント名・プラン・全体管理者メール・氏名). Dealer-type tenant
// creation is **out of scope** for T-02-08 — only WHOLESALER テナントを作成する。
//
// `TenantUpdateSchema` is used by `updateTenantStatusAction` (and any future
// rename / plan-change Server Action). すべて partial。

import { z } from "zod";

export const TenantTypeSchema = z.enum(["WHOLESALER", "DEALER"]);
export type TenantTypeValue = z.infer<typeof TenantTypeSchema>;

// docs/05 §3.2 `TenantPlan` の値 (PILOT / SMALL / MEDIUM / LARGE)。
// 本タスクの作成フォーム (S-015) では SMALL / MEDIUM / LARGE / CUSTOM を提示する
// （タスク仕様）。`CUSTOM` はスキーマ enum に存在しないので、内部的には未指定
// （null）として扱う設計に倒すべきだが、現行 schema enum を尊重し PILOT を含む
// 全 4 値を受け入れる。CUSTOM はフォーム側の見せ方で対応する（後続 T-02-09）。
export const TenantPlanSchema = z.enum(["PILOT", "SMALL", "MEDIUM", "LARGE"]);
export type TenantPlanValue = z.infer<typeof TenantPlanSchema>;

export const TenantStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);
export type TenantStatusValue = z.infer<typeof TenantStatusSchema>;

const emailField = z
  .string()
  .trim()
  .min(1, "メールアドレスを入力してください")
  .max(255)
  .email("メールアドレスの形式が正しくありません")
  // 大文字小文字差を吸収して User.email の UNIQUE 衝突判定と一致させる。
  .transform((v) => v.toLowerCase());

const nameField = (msg: string) => z.string().trim().min(1, msg).max(255);

export const CreateTenantSchema = z.object({
  name: nameField("テナント名を入力してください"),
  // 本タスクは WHOLESALER のみ対応。DEALER 作成は F-007 セルフサインアップ経路。
  type: z.literal("WHOLESALER").default("WHOLESALER"),
  plan: TenantPlanSchema,
  adminEmail: emailField,
  adminName: nameField("管理者氏名を入力してください"),
});
export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

export const TenantUpdateSchema = z.object({
  name: nameField("テナント名を入力してください").optional(),
  plan: TenantPlanSchema.optional(),
  status: TenantStatusSchema.optional(),
});
export type TenantUpdateInput = z.infer<typeof TenantUpdateSchema>;
