"use server";

// 商談履歴（CustomerActivity）Server Actions — 顧客詳細「新規記録」.
//
// 三段イディオム: auth → assertCan → withTenant tx。
// - presign / create は customer.update（編集権限）、download は customer.read。
// - customerId は input から受けるが、withTenant の RLS が Customer.wholesalerId 経由の
//   相関 EXISTS でテナント分離を強制する。各クエリは必ず withTenant 内で実行する。

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  CustomerActivityCreateSchema,
  CustomerActivityFileRecordSchema,
  CustomerFileRecordSchema,
  CustomerTaskCreateSchema,
  PresignCustomerFileSchema,
} from "@solar/contracts";
import type {
  CustomerActivityCreateInput,
  CustomerActivityFileRecordInput,
  CustomerFileRecordInput,
  CustomerTaskCreateInput,
  PresignCustomerFileInput,
} from "@solar/contracts";
import { presignDownload, presignUpload } from "@solar/storage";

import { NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

import type { TxClient } from "@/lib/tenancy/with-tenant";

const DETAIL_PATH = (id: string) => `/customers/${id}`;

function sanitizeFileName(name: string): string {
  // R2 オブジェクトキーで使えない文字を `_` に潰す（パス区切り含む）。
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 200) || "file";
}

// 設置申請（Application）が当該 customer 配下か検証する（RLS スコープ内で相関 EXISTS）。
// 越境（他テナント/他顧客）の applicationId は NotFoundError。null/undefined は素通り。
async function assertApplicationInCustomer(
  tx: TxClient,
  applicationId: string | null | undefined,
  customerId: string,
): Promise<void> {
  if (!applicationId) return;
  const app = await tx.application.findFirst({
    where: { id: applicationId, contract: { customerId } },
    select: { id: true },
  });
  if (!app) {
    throw new NotFoundError("設置申請が見つかりません");
  }
}

export interface PresignCustomerFileResult {
  fileKey: string;
  putUrl: string;
  headers: Record<string, string>;
}

export const presignCustomerFileUpload = withServerActionContext<
  PresignCustomerFileInput,
  PresignCustomerFileResult
>(
  { action: "customer.update" },
  async ({ tx, input }) => {
    const parsed = PresignCustomerFileSchema.parse(input);

    const customer = await tx.customer.findUnique({
      where: { id: parsed.customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundError("顧客が見つかりません");
    }
    await assertApplicationInCustomer(tx, parsed.applicationId, parsed.customerId);

    const prefix =
      parsed.category === "APPLICATION"
        ? "applications"
        : parsed.category === "PV_DRAWING"
          ? "pv-drawings"
          : parsed.category === "CONTRACT"
            ? "contracts"
            : parsed.category === "QUOTE"
              ? "quotes"
              : "files";
    const key = `customers/${parsed.customerId}/${prefix}/${randomUUID()}-${sanitizeFileName(parsed.fileName)}`;
    const { putUrl, headers } = await presignUpload({
      key,
      contentType: parsed.contentType,
    });

    return { fileKey: key, putUrl, headers };
  },
);

export interface CreateCustomerActivityResult {
  id: string;
}

export const createCustomerActivity = withServerActionContext<
  CustomerActivityCreateInput,
  CreateCustomerActivityResult
>(
  { action: "customer.update" },
  async ({ tx, ctx, input }) => {
    const parsed = CustomerActivityCreateSchema.parse(input);

    const customer = await tx.customer.findUnique({
      where: { id: parsed.customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundError("顧客が見つかりません");
    }

    // 担当者は同テナントの User か検証（RLS スコープ内で解決できなければ拒否）。
    let assigneeUserId: string | null = null;
    if (parsed.assigneeUserId) {
      const assignee = await tx.user.findUnique({
        where: { id: parsed.assigneeUserId },
        select: { id: true },
      });
      if (!assignee) {
        throw new NotFoundError("担当者が見つかりません");
      }
      assigneeUserId = assignee.id;
    }

    const activity = await tx.customerActivity.create({
      data: {
        customerId: parsed.customerId,
        occurredAt: new Date(parsed.occurredAt),
        category: parsed.category,
        detail: parsed.detail,
        amount: parsed.category === "quote" ? (parsed.amount ?? null) : null,
        assigneeUserId,
        createdByUserId: ctx.actorUserId,
      },
      select: { id: true },
    });

    for (const task of parsed.tasks) {
      await tx.customerTask.create({
        data: {
          customerId: parsed.customerId,
          activityId: activity.id,
          content: task.content,
          dueDate: task.dueDate ? new Date(task.dueDate) : null,
          assigneeUserId: task.assigneeUserId ?? null,
          createdByUserId: ctx.actorUserId,
        },
      });
    }

    for (const file of parsed.files) {
      await tx.customerFile.create({
        data: {
          customerId: parsed.customerId,
          activityId: activity.id,
          fileKey: file.fileKey,
          fileName: file.fileName,
          contentType: file.contentType ?? null,
          size: file.size ?? null,
          uploadedByUserId: ctx.actorUserId,
        },
      });
    }

    revalidatePath(DETAIL_PATH(parsed.customerId));
    return { id: activity.id };
  },
);

// 関連ファイルタブの直接アップロード後、CustomerFile を 1 件記録する（activityId は null）。
export const createCustomerFile = withServerActionContext<CustomerFileRecordInput, { id: string }>(
  { action: "customer.update" },
  async ({ tx, ctx, input }) => {
    const parsed = CustomerFileRecordSchema.parse(input);

    const customer = await tx.customer.findUnique({
      where: { id: parsed.customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundError("顧客が見つかりません");
    }
    await assertApplicationInCustomer(tx, parsed.applicationId, parsed.customerId);

    const file = await tx.customerFile.create({
      data: {
        customerId: parsed.customerId,
        applicationId: parsed.applicationId ?? null,
        fileKey: parsed.fileKey,
        fileName: parsed.fileName,
        contentType: parsed.contentType ?? null,
        size: parsed.size ?? null,
        category: parsed.category,
        uploadedByUserId: ctx.actorUserId,
      },
      select: { id: true },
    });

    revalidatePath(DETAIL_PATH(parsed.customerId));
    return { id: file.id };
  },
);

// 既存アクティビティ（見積提示）に紐づくファイルを 1 件記録する（見積書アップロード）。
// activityId が同一 customer の活動か検証してから作成する。
export const createCustomerActivityFile = withServerActionContext<
  CustomerActivityFileRecordInput,
  { id: string }
>(
  { action: "customer.update" },
  async ({ tx, ctx, input }) => {
    const parsed = CustomerActivityFileRecordSchema.parse(input);

    const activity = await tx.customerActivity.findUnique({
      where: { id: parsed.activityId },
      select: { id: true, customerId: true },
    });
    if (!activity || activity.customerId !== parsed.customerId) {
      throw new NotFoundError("見積記録が見つかりません");
    }

    const file = await tx.customerFile.create({
      data: {
        customerId: parsed.customerId,
        activityId: activity.id,
        fileKey: parsed.fileKey,
        fileName: parsed.fileName,
        contentType: parsed.contentType ?? null,
        size: parsed.size ?? null,
        category: parsed.category,
        uploadedByUserId: ctx.actorUserId,
      },
      select: { id: true },
    });

    revalidatePath(DETAIL_PATH(parsed.customerId));
    return { id: file.id };
  },
);

// ToDo タブの新規起票（CustomerTask を 1 件作成。activityId は null）。
export const createCustomerTask = withServerActionContext<CustomerTaskCreateInput, { id: string }>(
  { action: "customer.update" },
  async ({ tx, ctx, input }) => {
    const parsed = CustomerTaskCreateSchema.parse(input);

    const customer = await tx.customer.findUnique({
      where: { id: parsed.customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundError("顧客が見つかりません");
    }

    const task = await tx.customerTask.create({
      data: {
        customerId: parsed.customerId,
        content: parsed.content,
        dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null,
        assigneeUserId: parsed.assigneeUserId ?? null,
        createdByUserId: ctx.actorUserId,
      },
      select: { id: true },
    });

    revalidatePath(DETAIL_PATH(parsed.customerId));
    return { id: task.id };
  },
);

export interface CustomerFileDownloadResult {
  getUrl: string;
}

export const getCustomerFileDownloadUrl = withServerActionContext<
  string,
  CustomerFileDownloadResult
>(
  { action: "customer.read" },
  async ({ tx, input: fileId }) => {
    const file = await tx.customerFile.findUnique({
      where: { id: fileId },
      select: { fileKey: true },
    });
    if (!file) {
      throw new NotFoundError("ファイルが見つかりません");
    }

    const { getUrl } = await presignDownload({ key: file.fileKey });
    return { getUrl };
  },
);
