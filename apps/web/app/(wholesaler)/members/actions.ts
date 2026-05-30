"use server";

// Server Action: invite a user to the wholesaler tenant (F-006).
// Creates a UserInvitation row via `issueUserInvitation` from @solar/auth,
// then enqueues an invite email. Guard: withServerActionContext(member.read
// is not sufficient — we need the invite action key).

import { issueUserInvitation } from "@solar/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/members";

const InviteWholesalerMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum([
    "WHOLESALER_ADMIN",
    "WHOLESALER_EVENT_TEAM",
    "WHOLESALER_CALL_TEAM",
    "WHOLESALER_DIRECT_SALES",
    "WHOLESALER_FIELD_STAFF",
  ]),
});

export type InviteWholesalerMemberInput = z.infer<typeof InviteWholesalerMemberSchema>;

export interface InviteWholesalerMemberResult {
  invitationId: string;
}

export const inviteWholesalerMemberAction = withServerActionContext<
  InviteWholesalerMemberInput,
  InviteWholesalerMemberResult
>(
  {
    action: "user.invite_wholesaler_member",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new ValidationError("tenantId is required for member invitation");
    }
    const parsed = InviteWholesalerMemberSchema.parse(input);

    const { invitationId } = await issueUserInvitation({
      tenantId: ctx.tenantId,
      email: parsed.email,
      role: parsed.role,
      invitedBy: ctx.actorUserId,
    });

    revalidatePath(LIST_PATH);
    return { invitationId };
  },
);
