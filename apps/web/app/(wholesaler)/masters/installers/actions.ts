"use server";

// Installer master Server Actions (T-02-05 / F-013 / docs/05 §3.3).
//
// venue-providers と同じ三段ガード (auth → assertCan → withTenant) を
// `withServerActionContext` で適用。wholesalerId はテナント文脈から注入され、
// 入力で渡されることは無い（クロステナント操作を防ぐ）。
//
// 論理停止のみ: `disable` は `isActive=false` をフリップする。`installer` 行は
// 過去の Contract / WorkSchedule から参照されるため、物理削除は行わない
// （docs/02 §F-013 受け入れ基準）。

import {
  InstallerInputSchema,
  InstallerUpdateSchema,
  type InstallerInput,
  type InstallerUpdate,
} from "@solar/contracts";
import { revalidatePath } from "next/cache";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/masters/installers";

export interface CreateInstallerResult {
  id: string;
}

export const createInstallerAction = withServerActionContext<InstallerInput, CreateInstallerResult>(
  {
    action: "installer.create",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for installer master");
    }
    const parsed = InstallerInputSchema.parse(input);

    const created = await tx.installer.create({
      data: {
        wholesalerId: ctx.wholesalerId,
        name: parsed.name,
        area: parsed.area,
        phone: parsed.phone,
        email: parsed.email,
        contactName: parsed.contactName,
        ...(parsed.isActive !== undefined ? { isActive: parsed.isActive } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    return { id: created.id };
  },
);

export interface UpdateInstallerInput {
  id: string;
  patch: InstallerUpdate;
}

export interface UpdateInstallerResult {
  id: string;
}

export const updateInstallerAction = withServerActionContext<
  UpdateInstallerInput,
  UpdateInstallerResult
>(
  {
    action: "installer.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, input }) => {
    const parsed = InstallerUpdateSchema.parse(input.patch);

    // RLS via withTenant() restricts visibility — a missing row is
    // indistinguishable from a cross-tenant access and surfaces as NotFound
    // (docs/05 §9.1).
    const existing = await tx.installer.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("施工業者が見つかりません");
    }

    const updated = await tx.installer.update({
      where: { id: input.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...("area" in parsed ? { area: parsed.area } : {}),
        ...("phone" in parsed ? { phone: parsed.phone } : {}),
        ...("email" in parsed ? { email: parsed.email } : {}),
        ...("contactName" in parsed ? { contactName: parsed.contactName } : {}),
        ...(parsed.isActive !== undefined ? { isActive: parsed.isActive } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id };
  },
);

export interface DisableInstallerInput {
  id: string;
}

export interface DisableInstallerResult {
  id: string;
}

export const disableInstallerAction = withServerActionContext<
  DisableInstallerInput,
  DisableInstallerResult
>(
  {
    action: "installer.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, input }) => {
    const existing = await tx.installer.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("施工業者が見つかりません");
    }

    const updated = await tx.installer.update({
      where: { id: input.id },
      data: { isActive: false },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id };
  },
);
