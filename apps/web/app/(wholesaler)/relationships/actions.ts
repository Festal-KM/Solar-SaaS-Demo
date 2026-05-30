"use server";

// Server Actions for relationship management (F-009 / F-010).
//
// updateRelationshipAction — updates defaultScope and/or status.
// generateInviteCodeAction — issues a new InviteCode for the wholesaler.

import { createInviteCode } from "@solar/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/relationships";

// --- updateRelationshipAction ---

const UpdateRelationshipSchema = z.object({
  id: z.string().min(1),
  defaultScope: z.enum(["APPOINTMENT_ONLY", "FIRST_VISIT", "FULL_CLOSING"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

export type UpdateRelationshipInput = z.infer<typeof UpdateRelationshipSchema>;

export interface UpdateRelationshipResult {
  id: string;
}

export const updateRelationshipAction = withServerActionContext<
  UpdateRelationshipInput,
  UpdateRelationshipResult
>(
  {
    action: "relationship.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, input }) => {
    const parsed = UpdateRelationshipSchema.parse(input);
    if (!parsed.defaultScope && !parsed.status) {
      throw new ValidationError("defaultScope または status のいずれかが必要です");
    }

    const existing = await tx.relationship.findUnique({
      where: { id: parsed.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("取引先が見つかりません");
    }

    const updated = await tx.relationship.update({
      where: { id: parsed.id },
      data: {
        ...(parsed.defaultScope !== undefined ? { defaultScope: parsed.defaultScope } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    return { id: updated.id };
  },
);

// --- generateInviteCodeAction ---

const GenerateInviteCodeSchema = z.object({
  expiresAt: z.string().min(1),
  maxUses: z.number().int().min(1).max(100),
});

export type GenerateInviteCodeInput = z.infer<typeof GenerateInviteCodeSchema>;

export interface GenerateInviteCodeResult {
  code: string;
  inviteCodeId: string;
}

export const generateInviteCodeAction = withServerActionContext<
  GenerateInviteCodeInput,
  GenerateInviteCodeResult
>(
  {
    action: "relationship.generate_invite_code",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required");
    }
    const parsed = GenerateInviteCodeSchema.parse(input);
    const expiresAt = new Date(parsed.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new ValidationError("有効期限は未来の日時を指定してください");
    }

    const result = await createInviteCode({
      wholesalerId: ctx.wholesalerId,
      createdBy: ctx.actorUserId,
      maxUses: parsed.maxUses,
      expiresAt,
    });

    revalidatePath(LIST_PATH);
    return result;
  },
);
