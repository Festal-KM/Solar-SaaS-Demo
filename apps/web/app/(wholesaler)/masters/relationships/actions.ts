"use server";

// Server Actions for the dealer-relationships master.
//
// 二次店一覧（Tenant.type=DEALER とリレーションシップを張った相手）の
// ステータス（ACTIVE / SUSPENDED）切替と既定スコープの更新。新規 dealer の
// 作成は招待コードフロー (F-009 / SP-03) の責務なのでここでは扱わない。

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/masters/relationships";

const StatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);
const ScopeSchema = z.enum(["APPOINTMENT_ONLY", "FIRST_VISIT", "FULL_CLOSING"]);

const UpdateRelationshipInputSchema = z.object({
  id: z.string().min(1),
  franchiseNo: z.string().max(50).optional().nullable(),
  status: StatusSchema.optional(),
  defaultScope: ScopeSchema.optional(),
  note: z.string().max(2000).optional().nullable(),
});

export type UpdateRelationshipInput = z.infer<typeof UpdateRelationshipInputSchema>;

export interface UpdateRelationshipResult {
  id: string;
}

export const updateRelationshipAction = withServerActionContext<
  UpdateRelationshipInput,
  UpdateRelationshipResult
>(
  {
    action: "masters.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, input }) => {
    const parsed = UpdateRelationshipInputSchema.parse(input);

    const existing = await tx.relationship.findUnique({
      where: { id: parsed.id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("二次店との関係が見つかりません");
    }

    const updated = await tx.relationship.update({
      where: { id: parsed.id },
      data: {
        ...("franchiseNo" in parsed
          ? { franchiseNo: parsed.franchiseNo?.trim() ? parsed.franchiseNo.trim() : null }
          : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed.defaultScope !== undefined ? { defaultScope: parsed.defaultScope } : {}),
        ...("note" in parsed ? { note: parsed.note } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath("/masters");
    return { id: updated.id };
  },
);
