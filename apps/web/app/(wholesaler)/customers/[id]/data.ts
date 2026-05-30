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

import type { AcquisitionChannel } from "@solar/db";

import type {
  ContractStatusValue,
  ConstructionStatusValue,
  SubsidyStatusValue,
} from "../constants";
import { deriveArea } from "../data";

// 商談履歴のカテゴリ CODE（ラベル/チップ色は UI 側で解決）。
export type HistoryCategory = "event" | "phone" | "appointment" | "email" | "visit" | "other";

export interface HistoryEntry {
  id: string;
  date: string; // ISO
  category: HistoryCategory; // CODE（UI が label / color を解決）
  assignee: string;
  body: string;
}

export interface ContractStatusCard {
  status: ContractStatusValue;
  plan: string | null;
  expectedDate: string | null;
}

export interface ConstructionStatusCard {
  status: ConstructionStatusValue;
  plannedDate: string | null;
  completedDate: string | null;
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

export interface CustomerDetail {
  id: string;
  name: string; // masked
  kana: string | null;
  phone: string; // masked
  email: string | null;
  postalCode: string | null;
  address: string | null; // masked
  area: string | null;
  channel: AcquisitionChannel;
  assigneeName: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  contract: ContractStatusCard;
  construction: ConstructionStatusCard;
  subsidy: SubsidyStatusCard;
  history: HistoryEntry[];
  files: RelatedFile[];
  tasks: CustomerTask[];
}

function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

const HISTORY_CATEGORIES: readonly HistoryCategory[] = [
  "event",
  "phone",
  "appointment",
  "email",
  "visit",
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
        area: true,
        channel: true,
        registeredByUserId: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        contractStatus: true,
        contractPlan: true,
        contractExpectedDate: true,
        constructionStatus: true,
        constructionPlannedDate: true,
        constructionCompletedDate: true,
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
    const [activityRows, taskRows, fileRows] = await Promise.all([
      tx.customerActivity.findMany({
        where: { customerId: id },
        orderBy: { occurredAt: "desc" },
        select: { id: true, occurredAt: true, category: true, detail: true, createdByUserId: true },
      }),
      tx.customerTask.findMany({
        where: { customerId: id },
        orderBy: [{ done: "asc" }, { dueDate: "asc" }],
        select: { id: true, content: true, dueDate: true, assigneeUserId: true, done: true },
      }),
      tx.customerFile.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "desc" },
        select: { id: true, fileName: true, contentType: true, createdAt: true },
      }),
    ]);

    // createdByUserId / assigneeUserId を 1 回でまとめて解決（RLS スコープ内）。
    const userIds = [
      ...new Set(
        [
          ...activityRows.map((a) => a.createdByUserId),
          ...taskRows.map((t) => t.assigneeUserId).filter((v): v is string => !!v),
        ],
      ),
    ];
    const userRows =
      userIds.length > 0
        ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : [];
    const nameByUserId = new Map(userRows.map((u) => [u.id, u.name]));

    const history: HistoryEntry[] = activityRows.map((a) => ({
      id: a.id,
      date: a.occurredAt.toISOString(),
      category: toHistoryCategory(a.category),
      assignee: nameByUserId.get(a.createdByUserId) ?? "—",
      body: a.detail,
    }));

    const tasks: CustomerTask[] = taskRows.map((t) => ({
      id: t.id,
      name: t.content,
      due: formatDay(t.dueDate),
      assignee: (t.assigneeUserId ? nameByUserId.get(t.assigneeUserId) : null) ?? "—",
      done: t.done,
    }));

    const files: RelatedFile[] = fileRows.map((f) => ({
      id: f.id,
      name: f.fileName,
      type: fileType(f.fileName, f.contentType),
      date: formatDateTime(f.createdAt),
    }));

    return {
      id: customer.id,
      name: displayName,
      kana: customer.kana,
      phone: maskPhone(customer.phone, viewer),
      email: customer.email,
      postalCode: customer.postalCode,
      address: customer.address ? maskAddress(customer.address, viewer) : null,
      area: customer.area ?? deriveArea(customer.address),
      channel: customer.channel,
      assigneeName: assigneeDisplay,
      note: customer.note,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
      contract: {
        status: customer.contractStatus as ContractStatusValue,
        plan: customer.contractPlan,
        expectedDate: isoOrNull(customer.contractExpectedDate),
      },
      construction: {
        status: customer.constructionStatus as ConstructionStatusValue,
        plannedDate: isoOrNull(customer.constructionPlannedDate),
        completedDate: isoOrNull(customer.constructionCompletedDate),
      },
      subsidy: {
        status: customer.subsidyStatus as SubsidyStatusValue,
        type: customer.subsidyType,
        submittedDate: isoOrNull(customer.subsidySubmittedDate),
        grantedDate: isoOrNull(customer.subsidyGrantedDate),
      },
      history,
      files,
      tasks,
    };
  });
}
