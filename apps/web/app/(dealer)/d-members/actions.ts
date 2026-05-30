"use server";

// Server Action: invite a staff member to the dealer tenant (F-008).

import { issueUserInvitation } from "@solar/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/d-members";

const InviteDealerMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["DEALER_ADMIN", "DEALER_STAFF"]),
});

export type InviteDealerMemberInput = z.infer<typeof InviteDealerMemberSchema>;

export interface InviteDealerMemberResult {
  invitationId: string;
}

export const inviteDealerMemberAction = withServerActionContext<
  InviteDealerMemberInput,
  InviteDealerMemberResult
>(
  {
    action: "user.invite_dealer_member",
    resource: ({ ctx }) => (ctx.dealerId ? { dealerId: ctx.dealerId } : undefined),
  },
  async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new ValidationError("tenantId is required for member invitation");
    }
    const parsed = InviteDealerMemberSchema.parse(input);

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
