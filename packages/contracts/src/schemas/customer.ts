// Zod schemas for customer create / update (T-04-06 / F-031 / docs/05 §4.7).
//
// Key design decisions:
//   1. `channel === 'EVENT'` requires `sourceEventId` (docs/02 §F-031 refine).
//   2. `ownerRelationshipId` is accepted in the payload only when the caller is
//      a dealer. Wholesaler actions derive it from ctx.relationshipIds[0] / null
//      (self-hosted) — the field still exists in the schema so both actors share
//      one Zod surface.
//   3. `status` defaults to `NEW` on create.
//   4. Update schema is partial of create minus the channel refine (the channel
//      itself is immutable after creation in this MVP).

import { z } from "zod";

export const AcquisitionChannelEnum = z.enum([
  "EVENT",
  "WALK_IN",
  "TELE",
  "REFERRAL",
  "OTHER",
]);

export type AcquisitionChannel = z.infer<typeof AcquisitionChannelEnum>;

export const CustomerStatusEnum = z.enum([
  "NEW",
  "PRE_CALL_WAIT",
  "PRE_CALL_DONE",
  "VISIT_PLANNED",
  "IN_NEGOTIATION",
  "CONTRACTED",
  "LOST",
  "IN_CONSTRUCTION",
  "COMPLETED",
]);

export type CustomerStatus = z.infer<typeof CustomerStatusEnum>;

export const CustomerCreateSchema = z
  .object({
    name: z.string().trim().min(1, "氏名を入力してください").max(255),
    kana: z.string().max(255).optional(),
    phone: z.string().trim().min(1, "電話番号を入力してください").max(50),
    email: z
      .string()
      .max(255)
      .optional()
      .refine((v) => !v || /.+@.+\..+/.test(v), "メールアドレスの形式が正しくありません"),
    postalCode: z.string().max(20).optional(),
    address: z.string().max(500).optional(),
    housingType: z.string().max(100).optional(),
    pvInstalled: z.boolean().optional(),
    batteryInstalled: z.boolean().optional(),
    electricBill: z.string().max(100).optional(),
    household: z.string().max(100).optional(),
    channel: AcquisitionChannelEnum,
    sourceEventId: z.string().optional(),
    ownerRelationshipId: z.string().optional(),
    // status is optional at the input level; the default is applied by the schema.
    status: CustomerStatusEnum.optional().default("NEW"),
    note: z.string().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.channel === "EVENT" && !data.sourceEventId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceEventId"],
        message: "催事チャネルでは催事 ID を指定してください",
      });
    }
  });

export type CustomerCreateInput = z.input<typeof CustomerCreateSchema>;

// Update schema: all create fields are optional except the channel constraint
// is relaxed (channel itself is not updatable — omitted from update surface).
export const CustomerUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "氏名を入力してください").max(255).optional(),
  kana: z.string().max(255).optional(),
  phone: z.string().trim().min(1, "電話番号を入力してください").max(50).optional(),
  email: z
    .string()
    .max(255)
    .optional()
    .refine((v) => !v || /.+@.+\..+/.test(v), "メールアドレスの形式が正しくありません"),
  postalCode: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  area: z.string().max(255).nullable().optional(),
  housingType: z.string().max(100).optional(),
  pvInstalled: z.boolean().optional(),
  batteryInstalled: z.boolean().optional(),
  electricBill: z.string().max(100).optional(),
  household: z.string().max(100).optional(),
  status: CustomerStatusEnum.optional(),
  note: z.string().max(2000).optional(),
  // 担当者変更（顧客の registeredByUserId を更新）。
  registeredByUserId: z.string().min(1).optional(),
  // Manual status columns edited from the detail page status cards. Date fields
  // accept a `YYYY-MM-DD` (or ISO) string or null; the action converts to Date.
  contractStatus: z.enum(["negotiating", "contracted", "lost", "cancelled"]).optional(),
  contractPlan: z.string().max(255).nullable().optional(),
  contractExpectedDate: z.string().nullable().optional(),
  constructionStatus: z.enum(["not_started", "in_progress", "done"]).optional(),
  constructionPlannedDate: z.string().nullable().optional(),
  constructionCompletedDate: z.string().nullable().optional(),
  subsidyStatus: z.enum(["none", "applying", "granted"]).optional(),
  subsidyType: z.string().max(255).nullable().optional(),
  subsidySubmittedDate: z.string().nullable().optional(),
  subsidyGrantedDate: z.string().nullable().optional(),
});

export type CustomerUpdateInput = z.infer<typeof CustomerUpdateSchema>;

// ---------------------------------------------------------------------------
// 商談履歴（CustomerActivity）— 顧客詳細「新規記録」.
//
// `category` は CODE をそのまま保存する（ラベル/チップ色は UI 側で解決）。
// `occurredAt` は YYYY-MM-DD または ISO 文字列を受け取り、Server Action 側で
// Date に変換する。tasks / files は 0 件以上のネストレコード。
// ---------------------------------------------------------------------------

export const CustomerActivityCategoryEnum = z.enum([
  "event",
  "phone",
  "appointment",
  "email",
  "visit",
  "other",
]);

export type CustomerActivityCategory = z.infer<typeof CustomerActivityCategoryEnum>;

export const CustomerActivityCreateSchema = z.object({
  customerId: z.string().min(1),
  occurredAt: z.string().min(1),
  category: CustomerActivityCategoryEnum,
  detail: z.string().trim().min(1).max(4000),
  tasks: z
    .array(
      z.object({
        content: z.string().trim().min(1).max(500),
        dueDate: z.string().nullable().optional(),
        assigneeUserId: z.string().nullable().optional(),
      }),
    )
    .default([]),
  files: z
    .array(
      z.object({
        fileKey: z.string().min(1),
        fileName: z.string().min(1).max(255),
        contentType: z.string().nullable().optional(),
        size: z.number().int().nonnegative().nullable().optional(),
      }),
    )
    .default([]),
});

export type CustomerActivityCreateInput = z.input<typeof CustomerActivityCreateSchema>;

export const PresignCustomerFileSchema = z.object({
  customerId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
});

export type PresignCustomerFileInput = z.infer<typeof PresignCustomerFileSchema>;
