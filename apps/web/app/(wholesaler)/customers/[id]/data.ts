// Server-side loader for the wholesaler customer detail page (F-031 / docs/04
// §1.3 / wireframes/CustomerDetail.png). Same three-step idiom as the list
// loader: auth → assertCan('customer.read') → withTenant. PII (name/phone/
// address) is masked per WholesalerSettings; the three status cards read the
// MANUAL status columns straight off the Customer row; 商談履歴 / files / tasks
// read the dedicated CustomerActivity / CustomerTask / CustomerFile models.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { maskName, maskPhone, maskAddress } from "@solar/contracts/services/masking";
import type { ViewerContext } from "@solar/contracts/services/masking";
import type { InflowRoute } from "@solar/contracts";

import type { AcquisitionChannel } from "@solar/db";

import type {
  ContractStatusValue,
  ConstructionStatusValue,
  SubsidyStatusValue,
} from "../constants";
import { deriveArea } from "../data";

// 商談履歴のカテゴリ CODE（ラベル/チップ色は UI 側で解決）。
// "quote" は見積提示の記録（amount に提示金額を保持できる）。
export type HistoryCategory =
  | "tossup"
  | "event"
  | "phone"
  | "appointment"
  | "email"
  | "visit"
  | "quote"
  | "other";

export interface HistoryEntry {
  id: string;
  date: string; // ISO
  category: HistoryCategory; // CODE（UI が label / color を解決）
  assignee: string;
  body: string;
  amount: number | null; // 見積提示カテゴリのときの提示金額（円）。それ以外は null
}

export interface ContractStatusCard {
  status: ContractStatusValue;
  plan: string | null;
  amount: number | null; // 契約金額（円）
  expectedDate: string | null;
}

export interface ConstructionStatusCard {
  status: ConstructionStatusValue;
  plannedDate: string | null;
  completedDate: string | null;
  vendor: string | null; // 対応事業者
}

export interface SubsidyStatusCard {
  status: SubsidyStatusValue;
  type: string | null;
  submittedDate: string | null;
  grantedDate: string | null;
}

export interface RelatedFile {
  id: string;
  name: string;
  type: string; // "PDF" / "XLSX" など
  date: string; // 表示用文字列
}

export interface CustomerTask {
  id: string;
  name: string;
  due: string; // 表示用文字列
  assignee: string;
  done: boolean;
}

// 担当者の表示用（自社社員 or 二次店）。未設定は null。
export type AssigneeKind = "user" | "dealer";
export interface AssigneeDisplay {
  name: string;
  kind: AssigneeKind;
}

// 顧客チャット 1 件。
export interface ChatMessage {
  id: string;
  authorName: string;
  authorUserId: string;
  body: string;
  createdAt: string; // ISO
}

export interface CustomerDetail {
  id: string;
  name: string; // masked
  kana: string | null;
  phone: string; // masked
  email: string | null;
  postalCode: string | null;
  address: string | null; // masked
  prefecture: string | null;
  city: string | null;
  addressLine: string | null; // masked
  birthDate: string | null; // ISO（年齢は表示時に算出）
  buildYear: string | null; // ISO
  tossDept: string | null;
  belongDept: string | null;
  // 電気契約・設備（識別子・ステータス。マスキング不要・生値表示）。
  electricContractStatus: string | null;
  electricAccountNo: string | null;
  supplyPointNo: string | null;
  equipmentId: string | null;
  area: string | null;
  channel: AcquisitionChannel;
  inflowRoute: InflowRoute | null; // 流入経路（顧客情報で手動選択、未設定は null）
  maekakuStatus: "pending" | "done" | "unnecessary" | null; // マエカク状況（商談履歴タブで入力）
  nextAction: string | null; // 次回アクション（商談履歴タブで入力）
  nextAppointmentAt: string | null; // 次回アポ日程（ISO、商談履歴タブで入力）
  assigneeName: string;
  tossUp: AssigneeDisplay | null; // トスアップ担当（自社/二次店、未設定は null）
  closing: AssigneeDisplay | null; // クロージング担当（自社/二次店、未設定は null）
  note: string | null;
  createdAt: string;
  updatedAt: string;
  contract: ContractStatusCard;
  construction: ConstructionStatusCard;
  subsidy: SubsidyStatusCard;
  history: HistoryEntry[];
  files: RelatedFile[]; // 関連ファイルタブ（GENERAL）
  applicationFiles: RelatedFile[]; // 設置申請タブの申請関連ドキュメント（APPLICATION）
  pvDrawingFiles: RelatedFile[]; // 施工状況タブの PV設置図面（PV_DRAWING）
  tasks: CustomerTask[];
  messages: ChatMessage[];
  currentUserId: string; // 自分のメッセージ判定用（チャット右寄せ）
}

function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

const HISTORY_CATEGORIES: readonly HistoryCategory[] = [
  "tossup",
  "event",
  "phone",
  "appointment",
  "email",
  "visit",
  "quote",
  "other",
];

function toHistoryCategory(code: string): HistoryCategory {
  return (HISTORY_CATEGORIES as readonly string[]).includes(code)
    ? (code as HistoryCategory)
    : "other";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// タスク期限の表示（YYYY/MM/DD、未設定は "—"）。
function formatDay(d: Date | null | undefined): string {
  if (!d) return "—";
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

// ファイル作成日時の表示（YYYY/MM/DD HH:mm）。
function formatDateTime(d: Date): string {
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 表示用のファイル種別ラベル。拡張子優先、無ければ contentType サブタイプ。
function fileType(fileName: string, contentType: string | null): string {
  const m = fileName.match(/\.([a-zA-Z0-9]+)$/);
  if (m) return m[1]!.toUpperCase();
  if (contentType) {
    const sub = contentType.split("/")[1];
    if (sub) return sub.toUpperCase();
  }
  return "FILE";
}

export async function getCustomerDetail(id: string): Promise<CustomerDetail | null> {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
    });
  }
  const ctx = await getTenantContext();
  assertCan({
    user: {
      userId: ctx.actorUserId,
      roles: session.user.roles,
      isSaasAdmin: ctx.isSaasAdmin,
      tenantId: ctx.tenantId,
      wholesalerId: ctx.wholesalerId,
      dealerId: ctx.dealerId,
      relationshipIds: ctx.relationshipIds,
    },
    action: "customer.read",
  });

  return withTenant(ctx, async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        kana: true,
        phone: true,
        email: true,
        postalCode: true,
        address: true,
        prefecture: true,
        city: true,
        addressLine: true,
        birthDate: true,
        buildYear: true,
        tossDept: true,
        belongDept: true,
        electricContractStatus: true,
        electricAccountNo: true,
        supplyPointNo: true,
        equipmentId: true,
        area: true,
        channel: true,
        inflowRoute: true,
        maekakuStatus: true,
        nextAction: true,
        nextAppointmentAt: true,
        registeredByUserId: true,
        tossUpUserId: true,
        tossUpRelationshipId: true,
        closingUserId: true,
        closingRelationshipId: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        contractStatus: true,
        contractPlan: true,
        contractAmount: true,
        contractExpectedDate: true,
        constructionStatus: true,
        constructionPlannedDate: true,
        constructionCompletedDate: true,
        constructionVendor: true,
        subsidyStatus: true,
        subsidyType: true,
        subsidySubmittedDate: true,
        subsidyGrantedDate: true,
      },
    });
    if (!customer) return null;

    const settings = ctx.wholesalerId
      ? await tx.wholesalerSettings.findUnique({
          where: { wholesalerId: ctx.wholesalerId },
          select: { piiMaskingMode: true },
        })
      : null;
    const piiMaskingMode = (settings?.piiMaskingMode ?? "MASKED") as "FULL" | "PARTIAL" | "MASKED";
    const role = (session.user.roles[0] ?? "WHOLESALER_ADMIN") as ViewerContext["role"];
    const viewer: ViewerContext = {
      role,
      tenantType: "WHOLESALER",
      isSelfTenant: true,
      piiMaskingMode,
    };

    // 担当者 (the customer's registrant) name — tenant-scoped lookup; dealer-tenant
    // users are invisible under RLS → unresolved id falls back to "—".
    const assignee = await tx.user.findUnique({
      where: { id: customer.registeredByUserId },
      select: { name: true },
    });
    const displayName = maskName(customer.name, viewer);
    const assigneeDisplay = assignee?.name ?? "—";

    // 商談履歴 / タスク / 関連ファイル を専用モデルから読む（RLS は Customer.wholesalerId
    // 経由の相関 EXISTS で分離を強制）。
    const [activityRows, taskRows, fileRows, messageRows] = await Promise.all([
      tx.customerActivity.findMany({
        where: { customerId: id },
        orderBy: { occurredAt: "desc" },
        select: {
          id: true,
          occurredAt: true,
          category: true,
          detail: true,
          amount: true,
          createdByUserId: true,
        },
      }),
      tx.customerTask.findMany({
        where: { customerId: id },
        orderBy: [{ done: "asc" }, { dueDate: "asc" }],
        select: { id: true, content: true, dueDate: true, assigneeUserId: true, done: true },
      }),
      tx.customerFile.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "desc" },
        select: { id: true, fileName: true, contentType: true, category: true, createdAt: true },
      }),
      tx.customerMessage.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "asc" },
        select: { id: true, authorUserId: true, body: true, createdAt: true },
      }),
    ]);

    // createdByUserId / assigneeUserId / トスアップ・クロージング担当 を 1 回でまとめて
    // 解決（RLS スコープ内）。
    const userIds = [
      ...new Set(
        [
          ...activityRows.map((a) => a.createdByUserId),
          ...taskRows.map((t) => t.assigneeUserId).filter((v): v is string => !!v),
          ...messageRows.map((m) => m.authorUserId),
          customer.tossUpUserId,
          customer.closingUserId,
        ].filter((v): v is string => !!v),
      ),
    ];
    const userRows =
      userIds.length > 0
        ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : [];
    const nameByUserId = new Map(userRows.map((u) => [u.id, u.name]));

    // 担当者が二次店(Relationship)の場合の名称解決（卸業者は自テナントの relationship を
    // 参照可能）。relationship → dealer.name を引く。
    const relationshipIds = [
      ...new Set(
        [customer.tossUpRelationshipId, customer.closingRelationshipId].filter(
          (v): v is string => !!v,
        ),
      ),
    ];
    const relationshipRows =
      relationshipIds.length > 0
        ? await tx.relationship.findMany({
            where: { id: { in: relationshipIds } },
            select: { id: true, dealer: { select: { name: true } } },
          })
        : [];
    const dealerNameByRelId = new Map(relationshipRows.map((r) => [r.id, r.dealer.name]));

    // 担当主体の表示解決：二次店(Relationship) を優先、無ければ自社社員(User)、共に無ければ null。
    function resolveAssignee(
      userId: string | null,
      relationshipId: string | null,
    ): AssigneeDisplay | null {
      if (relationshipId) {
        return { name: dealerNameByRelId.get(relationshipId) ?? "—", kind: "dealer" };
      }
      if (userId) {
        return { name: nameByUserId.get(userId) ?? "—", kind: "user" };
      }
      return null;
    }

    const history: HistoryEntry[] = activityRows.map((a) => ({
      id: a.id,
      date: a.occurredAt.toISOString(),
      category: toHistoryCategory(a.category),
      assignee: nameByUserId.get(a.createdByUserId) ?? "—",
      body: a.detail,
      amount: a.amount ?? null,
    }));

    const tasks: CustomerTask[] = taskRows.map((t) => ({
      id: t.id,
      name: t.content,
      due: formatDay(t.dueDate),
      assignee: (t.assigneeUserId ? nameByUserId.get(t.assigneeUserId) : null) ?? "—",
      done: t.done,
    }));

    const toRelatedFile = (f: (typeof fileRows)[number]): RelatedFile => ({
      id: f.id,
      name: f.fileName,
      type: fileType(f.fileName, f.contentType),
      date: formatDateTime(f.createdAt),
    });
    // 関連ファイルタブは GENERAL のみ、設置申請タブは APPLICATION のみを表示。
    const files: RelatedFile[] = fileRows
      .filter((f) => f.category === "GENERAL")
      .map(toRelatedFile);
    const applicationFiles: RelatedFile[] = fileRows
      .filter((f) => f.category === "APPLICATION")
      .map(toRelatedFile);
    const pvDrawingFiles: RelatedFile[] = fileRows
      .filter((f) => f.category === "PV_DRAWING")
      .map(toRelatedFile);

    const messages: ChatMessage[] = messageRows.map((m) => ({
      id: m.id,
      authorUserId: m.authorUserId,
      authorName: nameByUserId.get(m.authorUserId) ?? "—",
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    }));

    return {
      id: customer.id,
      name: displayName,
      kana: customer.kana,
      phone: maskPhone(customer.phone, viewer),
      email: customer.email,
      postalCode: customer.postalCode,
      address: customer.address ? maskAddress(customer.address, viewer) : null,
      prefecture: customer.prefecture,
      city: customer.city,
      addressLine: customer.addressLine ? maskAddress(customer.addressLine, viewer) : null,
      birthDate: isoOrNull(customer.birthDate),
      buildYear: isoOrNull(customer.buildYear),
      tossDept: customer.tossDept,
      belongDept: customer.belongDept,
      electricContractStatus: customer.electricContractStatus,
      electricAccountNo: customer.electricAccountNo,
      supplyPointNo: customer.supplyPointNo,
      equipmentId: customer.equipmentId,
      area: customer.area ?? deriveArea(customer.address),
      channel: customer.channel,
      inflowRoute: (customer.inflowRoute as InflowRoute | null) ?? null,
      maekakuStatus: (customer.maekakuStatus as "pending" | "done" | "unnecessary" | null) ?? null,
      nextAction: customer.nextAction,
      nextAppointmentAt: isoOrNull(customer.nextAppointmentAt),
      assigneeName: assigneeDisplay,
      tossUp: resolveAssignee(customer.tossUpUserId, customer.tossUpRelationshipId),
      closing: resolveAssignee(customer.closingUserId, customer.closingRelationshipId),
      note: customer.note,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
      contract: {
        status: customer.contractStatus as ContractStatusValue,
        plan: customer.contractPlan,
        amount: customer.contractAmount ?? null,
        expectedDate: isoOrNull(customer.contractExpectedDate),
      },
      construction: {
        status: customer.constructionStatus as ConstructionStatusValue,
        plannedDate: isoOrNull(customer.constructionPlannedDate),
        completedDate: isoOrNull(customer.constructionCompletedDate),
        vendor: customer.constructionVendor ?? null,
      },
      subsidy: {
        status: customer.subsidyStatus as SubsidyStatusValue,
        type: customer.subsidyType,
        submittedDate: isoOrNull(customer.subsidySubmittedDate),
        grantedDate: isoOrNull(customer.subsidyGrantedDate),
      },
      history,
      files,
      applicationFiles,
      pvDrawingFiles,
      tasks,
      messages,
      currentUserId: ctx.actorUserId,
    };
  });
}
