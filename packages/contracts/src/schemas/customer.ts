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

// 流入経路（顧客情報で手動選択する 3 区分）。
export const InflowRouteEnum = z.enum(["EVENT", "OUTBOUND_CALL", "DIRECT_VISIT"]);

export type InflowRoute = z.infer<typeof InflowRouteEnum>;

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
  // 連絡先構造化（docs/05 §16-A）
  prefecture: z.string().max(20).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  addressLine: z.string().max(255).nullable().optional(),
  birthDate: z.string().nullable().optional(),
  buildYear: z.string().nullable().optional(),
  tossDept: z.string().max(100).nullable().optional(),
  belongDept: z.string().max(100).nullable().optional(),
  area: z.string().max(255).nullable().optional(),
  // 電気契約・設備（基本情報タブ。全て自由記述・null でクリア可）。
  electricContractStatus: z.string().max(255).nullable().optional(),
  electricAccountNo: z.string().max(100).nullable().optional(),
  supplyPointNo: z.string().max(100).nullable().optional(),
  equipmentId: z.string().max(100).nullable().optional(),
  housingType: z.string().max(100).optional(),
  pvInstalled: z.boolean().optional(),
  batteryInstalled: z.boolean().optional(),
  electricBill: z.string().max(100).optional(),
  household: z.string().max(100).optional(),
  status: CustomerStatusEnum.optional(),
  note: z.string().max(2000).optional(),
  // 流入経路（顧客情報で手動選択）。null で未設定にクリアできる。
  inflowRoute: InflowRouteEnum.nullable().optional(),
  // 商談履歴タブの状況入力。マエカク状況 / 次回アクション / 次回アポ日程
  // （商談ステータスは contractStatus）。日付は YYYY-MM-DD or ISO 文字列、null でクリア。
  maekakuStatus: z.enum(["pending", "done", "unnecessary"]).nullable().optional(),
  nextAction: z.string().max(2000).nullable().optional(),
  nextAppointmentAt: z.string().nullable().optional(),
  // 担当者変更（顧客の registeredByUserId = 登録者を更新）。
  registeredByUserId: z.string().min(1).optional(),
  // トスアップ担当 / クロージング担当。担当主体は自社社員(User) か二次店(Relationship)
  // のいずれか（排他）。各 null で未設定にクリアできる。
  tossUpUserId: z.string().min(1).nullable().optional(),
  tossUpRelationshipId: z.string().min(1).nullable().optional(),
  closingUserId: z.string().min(1).nullable().optional(),
  closingRelationshipId: z.string().min(1).nullable().optional(),
  // Manual status columns edited from the detail page status cards. Date fields
  // accept a `YYYY-MM-DD` (or ISO) string or null; the action converts to Date.
  contractStatus: z.enum(["negotiating", "contracted", "lost", "cancelled"]).optional(),
  contractPlan: z.string().max(255).nullable().optional(),
  contractAmount: z.number().int().nonnegative().nullable().optional(),
  contractExpectedDate: z.string().nullable().optional(),
  constructionStatus: z.enum(["not_started", "in_progress", "done"]).optional(),
  constructionPlannedDate: z.string().nullable().optional(),
  constructionCompletedDate: z.string().nullable().optional(),
  constructionVendor: z.string().max(255).nullable().optional(),
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
  "tossup",
  "event",
  "phone",
  "appointment",
  "email",
  "visit",
  "quote",
  "other",
]);

export type CustomerActivityCategory = z.infer<typeof CustomerActivityCategoryEnum>;

export const CustomerActivityCreateSchema = z.object({
  customerId: z.string().min(1),
  occurredAt: z.string().min(1),
  category: CustomerActivityCategoryEnum,
  detail: z.string().trim().min(1).max(4000),
  // 見積提示カテゴリのときの提示金額（円・整数・0 以上）。任意。
  amount: z.number().int().nonnegative().nullable().optional(),
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

// ---------------------------------------------------------------------------
// 顧客チャット（CustomerMessage）— 顧客詳細「チャット」タブ。
// ---------------------------------------------------------------------------

export const CustomerMessageCreateSchema = z.object({
  customerId: z.string().min(1),
  body: z.string().trim().min(1, "メッセージを入力してください").max(4000),
});

export type CustomerMessageCreateInput = z.infer<typeof CustomerMessageCreateSchema>;

// 顧客ファイルの用途カテゴリ。GENERAL=関連ファイルタブ、APPLICATION=設置申請タブの申請関連ドキュメント。
export const CustomerFileCategoryEnum = z.enum(["GENERAL", "APPLICATION"]);

export type CustomerFileCategory = z.infer<typeof CustomerFileCategoryEnum>;

// 単体ファイル記録（関連ファイルタブの直接アップロード。activity に紐づかない）。
export const CustomerFileRecordSchema = z.object({
  customerId: z.string().min(1),
  fileKey: z.string().min(1),
  fileName: z.string().min(1).max(255),
  contentType: z.string().nullable().optional(),
  size: z.number().int().nonnegative().nullable().optional(),
  category: CustomerFileCategoryEnum.default("GENERAL"),
});

export type CustomerFileRecordInput = z.infer<typeof CustomerFileRecordSchema>;

// ToDo 単体作成（ToDo タブの新規起票。activity に紐づかない）。
export const CustomerTaskCreateSchema = z.object({
  customerId: z.string().min(1),
  content: z.string().trim().min(1, "内容を入力してください").max(500),
  dueDate: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
});

export type CustomerTaskCreateInput = z.infer<typeof CustomerTaskCreateSchema>;

// ---------------------------------------------------------------------------
// F-063 住環境・家族属性ヒアリング（docs/05 §17.4 / §17.9）.
//
// 顧客フォームの「住環境・家族ヒアリング」セクション保存ペイロード。Customer 拡張列・
// 既設設備配列（category 単位 upsert）・代表アポの acquiredAt を 1 つの面で受ける。
// installDate は未来日不可、capacityKw/panelCount は 0 以上、年齢は 0..120。
// ---------------------------------------------------------------------------

export const GuideAttendeeEnum = z.enum(["HUSBAND", "WIFE", "BOTH", "OTHER"]);
export type GuideAttendee = z.infer<typeof GuideAttendeeEnum>;

export const ExistingEquipmentCategoryEnum = z.enum(["GAS_WATER_HEATER", "ECO_CUTE", "PV"]);
export type ExistingEquipmentCategory = z.infer<typeof ExistingEquipmentCategoryEnum>;

export const ExistingEquipmentPresenceEnum = z.enum(["YES", "NO", "UNKNOWN"]);
export type ExistingEquipmentPresence = z.infer<typeof ExistingEquipmentPresenceEnum>;

// 設置日は当日 or 過去日（未来日拒否、docs/02 受け入れ基準）。日付未指定は許容。
const pastOrTodayDate = z
  .string()
  .nullable()
  .optional()
  .refine(
    (v) => {
      if (!v) return true;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return false;
      // 当日終端まで許容（タイムゾーン差で今日を弾かないため）。
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      return d.getTime() <= endOfToday.getTime();
    },
    { message: "設置日は当日または過去日を指定してください" },
  );

export const ExistingEquipmentInputSchema = z.object({
  category: ExistingEquipmentCategoryEnum,
  installed: ExistingEquipmentPresenceEnum.default("UNKNOWN"),
  installDate: pastOrTodayDate,
  maker: z.string().max(255).nullable().optional(),
  capacityKw: z.number().nonnegative().nullable().optional(),
  panelCount: z.number().int().nonnegative().nullable().optional(),
  attributes: z.record(z.unknown()).nullable().optional(),
});

export type ExistingEquipmentInput = z.infer<typeof ExistingEquipmentInputSchema>;

const ageField = z.number().int().min(0).max(120).nullable().optional();

export const CustomerHearingSchema = z.object({
  customerId: z.string().min(1),
  // 連絡先 2 系統分離（phone は別途・併存）。
  landlinePhone: z.string().max(50).nullable().optional(),
  mobilePhone: z.string().max(50).nullable().optional(),
  // 家族属性（ヒアリング値）。
  husbandAge: ageField,
  wifeAge: ageField,
  childAge: ageField,
  household: z.string().max(100).nullable().optional(),
  guideAttendee: GuideAttendeeEnum.nullable().optional(),
  faceToFace: z.boolean().nullable().optional(),
  // 提案商材（自由記述 + 任意の商品マスタ参照）。
  proposedProduct: z.string().max(255).nullable().optional(),
  proposedProductId: z.string().min(1).nullable().optional(),
  // マエカク電話希望日時 / アポ取得日（代表アポへ反映）。
  maekakuPreferredAt: z.string().nullable().optional(),
  acquiredAt: z.string().nullable().optional(),
  // 既設設備の現況（category 単位 upsert。1 顧客 × 1 カテゴリ 1 行）。
  existingEquipments: z.array(ExistingEquipmentInputSchema).default([]),
});

export type CustomerHearingInput = z.infer<typeof CustomerHearingSchema>;

export const PresignCustomerFileSchema = z.object({
  customerId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  category: CustomerFileCategoryEnum.default("GENERAL"),
});

export type PresignCustomerFileInput = z.infer<typeof PresignCustomerFileSchema>;
