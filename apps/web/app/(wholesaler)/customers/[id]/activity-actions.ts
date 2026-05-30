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
  PresignCustomerFileSchema,
} from "@solar/contracts";
import type {
  CustomerActivityCreateInput,
  PresignCustomerFileInput,
} from "@solar/contracts";
import { presignDownload, presignUpload } from "@solar/storage";

import { NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const DETAIL_PATH = (id: string) => `/customers/${id}`;

function sanitizeFileName(name: string): string {
  // R2 オブジェクトキーで使えない文字を `_` に潰す（パス区切り含む）。
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 200) || "file";
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

    const key = `customers/${parsed.customerId}/${randomUUID()}-${sanitizeFileName(parsed.fileName)}`;
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

    const activity = await tx.customerActivity.create({
      data: {
        customerId: parsed.customerId,
        occurredAt: new Date(parsed.occurredAt),
        category: parsed.category,
        detail: parsed.detail,
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
