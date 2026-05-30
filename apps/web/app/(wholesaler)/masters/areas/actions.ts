"use server";

// Area master Server Actions (エリアマスタ).
//
// installers と同じ三段ガード (auth → assertCan → withTenant) を
// `withServerActionContext` で適用。wholesalerId はテナント文脈から注入され、
// 入力で渡されることは無い（クロステナント操作を防ぐ）。
//
// 論理停止のみ: `disable` は `isActive=false` をフリップする。エリアは過去の
// EventCandidate から（文字列として）参照されるため、物理削除は行わない。

import {
  AreaInputSchema,
  AreaUpdateSchema,
  type AreaInput,
  type AreaUpdate,
} from "@solar/contracts";
import { revalidatePath } from "next/cache";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/masters/areas";

export interface CreateAreaResult {
  id: string;
}

export const createAreaAction = withServerActionContext<AreaInput, CreateAreaResult>(
  {
    action: "area.create",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for area master");
    }
    const parsed = AreaInputSchema.parse(input);

    const created = await tx.area.create({
      data: {
        wholesalerId: ctx.wholesalerId,
        name: parsed.name,
        ...(parsed.isActive !== undefined ? { isActive: parsed.isActive } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    return { id: created.id };
  },
);

export interface UpdateAreaInput {
  id: string;
  patch: AreaUpdate;
}

export interface UpdateAreaResult {
  id: string;
}

export const updateAreaAction = withServerActionContext<UpdateAreaInput, UpdateAreaResult>(
  {
    action: "area.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, input }) => {
    const parsed = AreaUpdateSchema.parse(input.patch);

    // RLS via withTenant() restricts visibility — a missing row is
    // indistinguishable from a cross-tenant access and surfaces as NotFound.
    const existing = await tx.area.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("エリアが見つかりません");
    }

    const updated = await tx.area.update({
      where: { id: input.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.isActive !== undefined ? { isActive: parsed.isActive } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id };
  },
);

export interface DisableAreaInput {
  id: string;
}

export interface DisableAreaResult {
  id: string;
}

export const disableAreaAction = withServerActionContext<DisableAreaInput, DisableAreaResult>(
  {
    action: "area.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, input }) => {
    const existing = await tx.area.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("エリアが見つかりません");
    }

    const updated = await tx.area.update({
      where: { id: input.id },
      data: { isActive: false },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id };
  },
);
