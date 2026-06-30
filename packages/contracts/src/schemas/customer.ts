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

// 営業ステータス（Customer.contractStatus, String 列）。仕様の主要 6 値
// （初訪前 / 商談中 / 見積提示済 / 契約対応中 / 契約済 / 失注）＋既存 cancelled（解約）。
export const ContractStatusEnum = z.enum([
  "pre_visit",
  "negotiating",
  "quote_presented",
  "contract_pending",
  "contracted",
  "lost",
  "cancelled",
]);

export type ContractStatusValue = z.infer<typeof ContractStatusEnum>;

// 設置申請ステータス（Customer.subsidyStatus, String 列）。
// 申請前 / 申請準備中 / 申請済 / 修正対応中 / 完了。
export const SubsidyStatusEnum = z.enum([
  "not_applied",
  "preparing",
  "applied",
  "revising",
  "completed",
]);

export type SubsidyStatusValue = z.infer<typeof SubsidyStatusEnum>;

// 現地調査ステータス（Construction.surveyStatus, String? 列。施工ステータスとは別管理）。
export const SurveyStatusEnum = z.enum(["not_surveyed", "scheduled", "surveyed"]);

export type SurveyStatusValue = z.infer<typeof SurveyStatusEnum>;

// コール状況ステータス値域（バッチ B）。完工コール / ローン完了コール 共通。
// 選択 UI・バリデーション・DTO が単一参照する真実（CONTRACT_STATUS_VALUES 等に倣う）。
export const CALL_STATUS_VALUES = ["not_done", "done", "unnecessary"] as const;

export const CallStatusEnum = z.enum(CALL_STATUS_VALUES);

export type CallStatusValue = z.infer<typeof CallStatusEnum>;

// ローン審査ステータス値域（バッチ C）。ContractPayment.loanReviewStatus。
// 審査前 / 審査中 / 完了 / 不備在り。選択 UI・バリデーション・DTO が単一参照する真実。
export const LOAN_REVIEW_STATUS_VALUES = [
  "not_reviewed",
  "reviewing",
  "completed",
  "defect",
] as const;

export const LoanReviewStatusEnum = z.enum(LOAN_REVIEW_STATUS_VALUES);

export type LoanReviewStatusValue = z.infer<typeof LoanReviewStatusEnum>;

// ローン審査履歴ログの結果値域（LoanReviewLog.result）。可決 / 否決 / 不備 / その他。
export const LOAN_REVIEW_RESULT_VALUES = ["approved", "rejected", "defect", "other"] as const;

export const LoanReviewResultEnum = z.enum(LOAN_REVIEW_RESULT_VALUES);

export type LoanReviewResultValue = z.infer<typeof LoanReviewResultEnum>;

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
  // 特記事項（契約タブのフリーテキストメモ）。基本情報タブの note とは別概念。null でクリア可。
  specialNote: z.string().max(4000).nullable().optional(),
  // 流入経路（顧客情報で手動選択）。null で未設定にクリアできる。
  inflowRoute: InflowRouteEnum.nullable().optional(),
  // 商談履歴タブの状況入力。マエカク状況 / 次回アクション / 次回アポ日程
  // （商談ステータスは contractStatus）。日付は YYYY-MM-DD or ISO 文字列、null でクリア。
  maekakuStatus: z.enum(["pending", "done", "unnecessary"]).nullable().optional(),
  nextAction: z.string().max(2000).nullable().optional(),
  nextAppointmentAt: z.string().nullable().optional(),
  // 次回アポ担当者（自社 User）。商談タブで編集、コールタブで read-only 表示。null でクリア。
  nextAppointmentAssigneeUserId: z.string().min(1).nullable().optional(),
  // マエカク電話希望日時（maekakuStatus と併存）。日付は YYYY-MM-DD or ISO 文字列、null でクリア。
  maekakuPreferredAt: z.string().nullable().optional(),
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
  contractStatus: ContractStatusEnum.optional(),
  contractPlan: z.string().max(255).nullable().optional(),
  contractAmount: z.number().int().nonnegative().nullable().optional(),
  contractExpectedDate: z.string().nullable().optional(),
  constructionStatus: z.enum(["not_started", "in_progress", "done"]).optional(),
  constructionPlannedDate: z.string().nullable().optional(),
  constructionCompletedDate: z.string().nullable().optional(),
  constructionVendor: z.string().max(255).nullable().optional(),
  subsidyStatus: SubsidyStatusEnum.optional(),
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
  // 記録の担当者（営業担当）。createdByUserId（作成者/監査）とは別概念。未設定は null。
  assigneeUserId: z.string().min(1).nullable().optional(),
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

// 顧客ファイルの用途カテゴリ。GENERAL=関連ファイルタブ、APPLICATION=設置申請タブの申請関連ドキュメント、
// PV_DRAWING=施工状況タブの PV設置図面（PDF）専用スロット（バッチ C）、CONTRACT=契約状況タブの契約関連ファイル、
// QUOTE=見積セクションの見積書ファイル（見積提示アクティビティに紐づく）。
export const CustomerFileCategoryEnum = z.enum([
  "GENERAL",
  "APPLICATION",
  "PV_DRAWING",
  "CONTRACT",
  "QUOTE",
]);

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

// 既存アクティビティ（見積提示）に紐づくファイル記録。見積セクションの見積書アップロード用。
// activityId は同一 customer の活動か Server Action 側で検証する。
export const CustomerActivityFileRecordSchema = z.object({
  customerId: z.string().min(1),
  activityId: z.string().min(1),
  fileKey: z.string().min(1),
  fileName: z.string().min(1).max(255),
  contentType: z.string().nullable().optional(),
  size: z.number().int().nonnegative().nullable().optional(),
  category: CustomerFileCategoryEnum.default("QUOTE"),
});

export type CustomerActivityFileRecordInput = z.infer<typeof CustomerActivityFileRecordSchema>;

// ToDo 単体作成（ToDo タブの新規起票。activity に紐づかない）。
export const CustomerTaskCreateSchema = z.object({
  customerId: z.string().min(1),
  content: z.string().trim().min(1, "内容を入力してください").max(500),
  dueDate: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
});

export type CustomerTaskCreateInput = z.infer<typeof CustomerTaskCreateSchema>;

// ---------------------------------------------------------------------------
// 過去コール履歴（CustomerCallLog）— コールタブから追加する架電実績.
//
// 架電日時 / 対応者（自社 User）/ メモ のみのシンプルな構成。calledAt は必須。
// handlerUserId（対応者）は同テナント User を Server Action で検証する。
// createdByUserId（作成者/監査）は ctx 由来であり入力には含めない。
// ---------------------------------------------------------------------------
export const CustomerCallLogCreateSchema = z.object({
  customerId: z.string().min(1),
  calledAt: z.string().min(1, "架電日時を入力してください"),
  handlerUserId: z.string().min(1).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export type CustomerCallLogCreateInput = z.infer<typeof CustomerCallLogCreateSchema>;

export const CustomerCallLogDeleteSchema = z.object({
  customerId: z.string().min(1),
  callLogId: z.string().min(1),
});

export type CustomerCallLogDeleteInput = z.infer<typeof CustomerCallLogDeleteSchema>;

// ---------------------------------------------------------------------------
// ローン審査（LoanReview）— 顧客 1:N・契約タブと同型のサブタブ運用.
//
// 新規作成は customerId のみ受け取り、Server Action が最小レコード（status 既定
// not_reviewed）を生成する。インライン編集は部分更新（送ったフィールドのみ更新、
// undefined は無変更・null はクリア）。createdByUserId は ctx 由来（input に含めない）。
// status/defectStatus は値域 enum で制約。Contract のローン列とは別概念・別テーブル。
// ---------------------------------------------------------------------------

export const LoanReviewCreateSchema = z.object({
  customerId: z.string().min(1),
});

export type LoanReviewCreateInput = z.infer<typeof LoanReviewCreateSchema>;

export const LoanReviewSaveSchema = z.object({
  customerId: z.string().min(1),
  loanReviewId: z.string().min(1),
  status: LoanReviewStatusEnum.optional(),
  loanCompany: z.string().max(255).nullable().optional(),
  downPayment: z.number().int().nonnegative().nullable().optional(),
  creditLifeInsurance: z.boolean().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
});

export type LoanReviewSaveInput = z.infer<typeof LoanReviewSaveSchema>;

export const LoanReviewDeleteSchema = z.object({
  customerId: z.string().min(1),
  loanReviewId: z.string().min(1),
});

export type LoanReviewDeleteInput = z.infer<typeof LoanReviewDeleteSchema>;

// ローン審査履歴ログ（LoanReviewLog）— 各審査内に追加する日時+結果+メモ+不備内容。
// 不備はログ登録時に記録し、「不備内容・解消状況」セクションがログ横断で一覧表示する。
export const LoanReviewLogCreateSchema = z.object({
  customerId: z.string().min(1),
  loanReviewId: z.string().min(1),
  reviewedAt: z.string().min(1, "日時を入力してください"),
  result: LoanReviewResultEnum,
  note: z.string().max(2000).nullable().optional(),
  defectContent: z.string().max(2000).nullable().optional(),
  // 不備の担当者（自社 User）。記録者（createdByUserId）とは別概念。未設定は null。
  assigneeUserId: z.string().min(1).nullable().optional(),
});

export type LoanReviewLogCreateInput = z.infer<typeof LoanReviewLogCreateSchema>;

export const LoanReviewLogDeleteSchema = z.object({
  customerId: z.string().min(1),
  loanReviewId: z.string().min(1),
  logId: z.string().min(1),
});

export type LoanReviewLogDeleteInput = z.infer<typeof LoanReviewLogDeleteSchema>;

// 不備の解消トグル（LoanReviewLog.defectResolved の更新）。不備一覧の解消/未解消切替で使う。
export const LoanReviewLogDefectResolveSchema = z.object({
  customerId: z.string().min(1),
  loanReviewId: z.string().min(1),
  logId: z.string().min(1),
  resolved: z.boolean(),
});

export type LoanReviewLogDefectResolveInput = z.infer<typeof LoanReviewLogDefectResolveSchema>;

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

// ---------------------------------------------------------------------------
// F-062 案件情報インライン編集（docs/05 §16）.
//
// 顧客詳細「基本情報」タブに統合された案件情報ビュー（CustomerProjectInfo）の
// 各セクションのインライン編集ペイロード。書き込み先エンティティごとに 1 スキーマ。
// 日付は YYYY-MM-DD or ISO 文字列で受け、Server Action 側で Date 化する。null で
// クリア可能。仕入値スナップショット（ContractItem.snapshotPurchasePrice 等）は
// 一切受け取らない（CLAUDE.md rule #4 / #5）。
// ---------------------------------------------------------------------------

// 概況（Customer 列）。住居種別・流入経路・マエカク状況・電気料金・世帯。
export const ProjectOverviewSchema = z.object({
  customerId: z.string().min(1),
  electricBill: z.string().max(100).nullable().optional(),
  household: z.string().max(100).nullable().optional(),
  housingType: z.string().max(100).nullable().optional(),
  inflowRoute: InflowRouteEnum.nullable().optional(),
  maekakuStatus: z.string().max(50).nullable().optional(),
});

export type ProjectOverviewInput = z.infer<typeof ProjectOverviewSchema>;

// 契約・支払・ローン（Contract + ContractPayment、1 契約単位）。
// 契約金額（contractAmount）は商材ライン amount 合計が正であり、本スキーマでは扱わない
// （saveProjectContractEquipmentAction が設備保存のたびに常時再計算する）。架電関連
// （callStatus / loanReviewCallAt）は本タブから除去した（DB 列は残置・UI からのみ除去）。
export const ProjectContractEditSchema = z.object({
  customerId: z.string().min(1),
  contractId: z.string().min(1),
  // Contract 列
  contractDate: z.string().nullable().optional(),
  equipmentSerialId: z.string().max(255).nullable().optional(),
  // ContractPayment 列（1:1。未存在時は upsert）
  paymentCount: z.number().int().nonnegative().nullable().optional(),
  paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID"]).optional(),
  depositDate: z.string().nullable().optional(),
  dealerPayoutDate: z.string().nullable().optional(),
  loanCompany: z.string().max(255).nullable().optional(),
  downPayment: z.number().int().nonnegative().nullable().optional(),
  creditLifeInsurance: z.boolean().nullable().optional(),
  loanNote: z.string().max(2000).nullable().optional(),
  // ローン審査ステータス（バッチ C）。null でクリア可、省略は無変更。
  loanReviewStatus: LoanReviewStatusEnum.nullable().optional(),
});

export type ProjectContractEditInput = z.infer<typeof ProjectContractEditSchema>;

// 契約の新規作成（契約 #2 以降の追加）。customerId のみ受け取り、Server Action が
// 最小 Deal + Contract を生成する（buildDemoContractSeed と同等・GrossProfit/Incentive
// は生成しない）。wholesalerId/ownerRelationshipId は Customer 由来（input から取らない）。
export const ProjectContractCreateSchema = z.object({
  customerId: z.string().min(1),
});

export type ProjectContractCreateInput = z.infer<typeof ProjectContractCreateSchema>;

// 契約の削除（任意）。GrossProfit/Incentive/ContractItem 等の依存がある契約は
// Server Action 側で削除不可ガードする。
export const ProjectContractDeleteSchema = z.object({
  customerId: z.string().min(1),
  contractId: z.string().min(1),
});

export type ProjectContractDeleteInput = z.infer<typeof ProjectContractDeleteSchema>;

// 商材ライン 1 行の削除（付帯商材の複数行運用で個別行を消す）。equipmentId は
// contractId 配下であることを Server Action が検証する（越境削除不可）。
export const ProjectContractEquipmentDeleteSchema = z.object({
  customerId: z.string().min(1),
  contractId: z.string().min(1),
  equipmentId: z.string().min(1),
});

export type ProjectContractEquipmentDeleteInput = z.infer<
  typeof ProjectContractEquipmentDeleteSchema
>;

// 設備明細（ContractEquipment の非価格フィールドのみ。価格・スナップショットは扱わない）。
export const ProjectEquipmentEditSchema = z.object({
  customerId: z.string().min(1),
  contractId: z.string().min(1),
  equipmentId: z.string().min(1),
  contracted: z.boolean().optional(),
  manufacturer: z.string().max(255).nullable().optional(),
  model: z.string().max(255).nullable().optional(),
  capacity: z.string().max(100).nullable().optional(),
  quantity: z.number().int().nonnegative().nullable().optional(),
  installLocation: z.string().max(255).nullable().optional(),
  introducedStatus: z.enum(["NONE", "EXISTING", "NEW"]).nullable().optional(),
  warrantyStandard: z.boolean().nullable().optional(),
  warrantyExtended: z.boolean().nullable().optional(),
  warrantyDisaster: z.boolean().nullable().optional(),
  detail: z.string().max(2000).nullable().optional(),
  attributes: z.record(z.unknown()).nullable().optional(),
});

export type ProjectEquipmentEditInput = z.infer<typeof ProjectEquipmentEditSchema>;

// 設備カテゴリ値域（ContractEquipment.category / EquipmentCategory enum と一致）。
// CONSTRUCTION = 契約商材ラインとしての施工（金額・業者・内容）。施工状況タブの
// Construction（工事進捗・fee 原価）とは別概念。
export const EQUIPMENT_CATEGORY_VALUES = [
  "PV",
  "BT",
  "EQ",
  "IH",
  "AC",
  "ACCESSORY",
  "GIFT",
  "CONSTRUCTION",
] as const;

export const EquipmentCategoryEnum = z.enum(EQUIPMENT_CATEGORY_VALUES);

export type EquipmentCategoryValue = z.infer<typeof EquipmentCategoryEnum>;

/**
 * Sum per-line product amounts (PV/BT/付帯/施工 …) into a contract total.
 * Pure — ignores null entries. Returns `null` when every line is null (so the
 * caller can distinguish "no amounts entered yet" from a real 0 total).
 */
export function sumEquipmentAmounts(
  amounts: ReadonlyArray<number | null | undefined>,
): number | null {
  let total = 0;
  let seen = false;
  for (const a of amounts) {
    if (a != null) {
      total += a;
      seen = true;
    }
  }
  return seen ? total : null;
}

// 契約状況タブでの「設備の追加・編集」ペイロード（契約 find-or-create 方式）。
//
// contractId は任意: 未指定なら顧客に契約が無いとみなし、Server Action がデモ用の
// 最小 Deal + Contract を find-or-create してから ContractEquipment を upsert する。
// equipmentId 指定時はその行を更新、未指定（新規追加）時は新しい行を作成する。これに
// より付帯商材（ACCESSORY）等を同一契約に複数行追加できる。PV/BT/施工等は呼び出し側が
// 代表 1 行の equipmentId を渡すことで従来どおり 1 行運用にできる。契約金額
// （Contract.contractAmount）は本アクションが設備 amount 合計から常時再計算する（手動
// 上書き経路は廃止）。仕入値スナップショット（ContractItem.snapshot*）は扱わない（#4 / #5）。
export const ProjectContractEquipmentUpsertSchema = z.object({
  customerId: z.string().min(1),
  contractId: z.string().min(1).nullable().optional(),
  category: EquipmentCategoryEnum,
  // 更新対象の ContractEquipment 行 ID。未指定は新規作成（複数行追加に対応）。
  equipmentId: z.string().min(1).nullable().optional(),
  // 商材ごとの契約金額（ContractEquipment.amount）。顧客向け金額（原価ではない）。
  // 円・整数・0 以上。null でクリア可、省略は無変更。
  amount: z.number().int().nonnegative().nullable().optional(),
  contracted: z.boolean().optional(),
  manufacturer: z.string().max(255).nullable().optional(),
  model: z.string().max(255).nullable().optional(),
  capacity: z.string().max(100).nullable().optional(),
  quantity: z.number().int().nonnegative().nullable().optional(),
  installLocation: z.string().max(255).nullable().optional(),
  introducedStatus: z.enum(["NONE", "EXISTING", "NEW"]).nullable().optional(),
  warrantyStandard: z.boolean().nullable().optional(),
  warrantyExtended: z.boolean().nullable().optional(),
  warrantyDisaster: z.boolean().nullable().optional(),
  detail: z.string().max(2000).nullable().optional(),
  attributes: z.record(z.unknown()).nullable().optional(),
});

export type ProjectContractEquipmentUpsertInput = z.infer<
  typeof ProjectContractEquipmentUpsertSchema
>;

// ---------------------------------------------------------------------------
// デモ用 Deal + Contract 最小生成パラメータ（純関数）.
//
// 契約成立フロー（クロージング）が本来の責務だが、契約状況タブでの設備入力を
// 成立させるためのデモ用途として、契約が無い顧客に最小 Deal + Contract を生成する。
// GrossProfit / Incentive は生成しない（損益・インセンティブ集計を汚さない）。
// contractDate = 今日、cancelDeadline = 今日 + 卸設定のキャンセル期限（既定 8 日）。
// 純関数として日付計算とデフォルト値を組み立て、Server Action から DB 書き込みに渡す。
// ---------------------------------------------------------------------------

export interface DemoContractSeedInput {
  /** Contract.contractAmount。未指定/null は 0 とする（後で編集可能）。 */
  contractAmount?: number | null;
  /** BT 設備が含まれるか（hasBattery 初期値）。 */
  hasBattery?: boolean;
  /** 卸の WholesalerSettings.cancelDeadlineDays（既定 8）。 */
  cancelDeadlineDays?: number;
  /** 基準日（既定 now）。テスト容易性のため注入可能。 */
  now?: Date;
}

export interface DemoContractSeedValues {
  contractDate: Date;
  cancelDeadline: Date;
  contractAmount: number;
  hasBattery: boolean;
  status: "CONTRACTED";
  dealStatus: "CONTRACTED";
}

/**
 * Builds the minimal Deal/Contract field values for a demo auto-created
 * contract. Pure — no DB access, no GrossProfit/Incentive (those stay
 * uncalculated by design). `cancelDeadline = contractDate + cancelDeadlineDays`.
 */
export function buildDemoContractSeed(input: DemoContractSeedInput = {}): DemoContractSeedValues {
  const now = input.now ?? new Date();
  const contractDate = new Date(now.getTime());
  const days = input.cancelDeadlineDays != null && input.cancelDeadlineDays >= 0
    ? input.cancelDeadlineDays
    : 8;
  const cancelDeadline = new Date(contractDate.getTime() + days * 24 * 60 * 60 * 1000);
  const amount =
    input.contractAmount != null && input.contractAmount >= 0 ? input.contractAmount : 0;
  return {
    contractDate,
    cancelDeadline,
    contractAmount: amount,
    hasBattery: input.hasBattery ?? false,
    status: "CONTRACTED",
    dealStatus: "CONTRACTED",
  };
}

// 工事・完工（Construction + 親 Contract の完工後/不備/サンキューコール列）。
export const ProjectConstructionEditSchema = z.object({
  customerId: z.string().min(1),
  contractId: z.string().min(1),
  constructionId: z.string().min(1),
  // Construction 列
  surveyDate: z.string().nullable().optional(),
  startedDate: z.string().nullable().optional(),
  completedDate: z.string().nullable().optional(),
  powerSaleStartDate: z.string().nullable().optional(),
  status: z
    .enum(["REQUEST_PENDING", "REQUESTED", "SURVEYED", "CONSTRUCTING", "DONE", "PAUSED"])
    .optional(),
  // 現地調査ステータス（施工ステータスとは別管理）。null でクリア可。
  surveyStatus: SurveyStatusEnum.nullable().optional(),
  vendorName: z.string().max(255).nullable().optional(),
  fee: z.number().int().nonnegative().nullable().optional(),
  // 親 Contract 列（完工後ステータス・不備・サンキューコール）
  postCompletionStatus: z.enum(["NONE", "IN_PROGRESS", "DONE"]).optional(),
  defectStatus: z.enum(["NONE", "OPEN", "RESOLVED"]).optional(),
  defectDetail: z.string().max(2000).nullable().optional(),
  thankYouCallAt: z.string().nullable().optional(),
});

export type ProjectConstructionEditInput = z.infer<typeof ProjectConstructionEditSchema>;

// 認定・設備（申請）（Application）。
export const ProjectApplicationEditSchema = z.object({
  customerId: z.string().min(1),
  contractId: z.string().min(1),
  applicationId: z.string().min(1),
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  type: z.string().max(255).nullable().optional(),
  submittedDate: z.string().nullable().optional(),
  approvedDate: z.string().nullable().optional(),
  grantedAmount: z.number().int().nonnegative().nullable().optional(),
});

export type ProjectApplicationEditInput = z.infer<typeof ProjectApplicationEditSchema>;

// ---------------------------------------------------------------------------
// コール状況（コールタブ 4 セクション）（Customer 列）.
//
// コールタブのインライン編集ペイロード。4 セクション（マエカクコール / サンキュー
// コール / ローン審査完了コール / 施工完了コール）それぞれの「ステータス（CallStatusEnum）
// + 希望日時 + メモ」を網羅する。マエカクはステータス（maekakuStatus: pending/done/
// unnecessary）+ 希望日時（maekakuPreferredAt・商談履歴タブと共用列）+ メモ。
// サンキューコール（thankYouCall*）は施工タブ Construction.thankYouCallAt とは別概念・別列。
// 日時は YYYY-MM-DD or ISO 文字列で受け、Server Action 側で Date 化する。
// 各 null でクリア可能、省略は無変更。マエカク希望電話は廃止（コールタブ上部に
// 固定電話/携帯電話を直接表示するため）。汎用コール希望時間帯は維持。
// ---------------------------------------------------------------------------
export const ProjectCallStatusSchema = z.object({
  customerId: z.string().min(1),
  // マエカクコール（ステータスは maekakuStatus: pending/done/unnecessary、希望日時は共用列）。
  maekakuStatus: z.enum(["pending", "done", "unnecessary"]).nullable().optional(),
  maekakuPreferredAt: z.string().nullable().optional(),
  maekakuCallNote: z.string().max(2000).nullable().optional(),
  // サンキューコール（CALL_STATUS_VALUES）。
  thankYouCallStatus: CallStatusEnum.nullable().optional(),
  thankYouCallPreferredAt: z.string().nullable().optional(),
  thankYouCallNote: z.string().max(2000).nullable().optional(),
  // ローン審査完了コール（CALL_STATUS_VALUES）。
  loanCompletionCallStatus: CallStatusEnum.nullable().optional(),
  loanCompletionCallPreferredAt: z.string().nullable().optional(),
  loanCompletionCallNote: z.string().max(2000).nullable().optional(),
  // 施工完了（完工）コール（CALL_STATUS_VALUES）。
  postCompletionCallStatus: CallStatusEnum.nullable().optional(),
  postCompletionCallPreferredAt: z.string().nullable().optional(),
  postCompletionCallNote: z.string().max(2000).nullable().optional(),
  // 汎用コール希望時間帯（自由記述）。
  generalCallPreferredTime: z.string().max(255).nullable().optional(),
});

export type ProjectCallStatusInput = z.infer<typeof ProjectCallStatusSchema>;
