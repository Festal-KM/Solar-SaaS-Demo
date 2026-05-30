"use server";

// Server Action for event-level dealer scope override (T-03-09 / F-024 /
// docs/05 §6.4 / docs/04 §S-027/S-030).
//
// `updateScopeOverrideAction` mutates `EventDealer.scopeOverride` for one
// (event, relationship) pair and records both an AuditLog entry and an
// EventChange entry so the change is fully auditable.
//
// Input:
//   eventId        — the Event (not EventCandidate) row
//   relationshipId — identifies which assigned dealer's scope to change
//   scopeOverride  — new DealerScope value, or null to revert to the
//                    relationship's defaultScope
//   reason         — required; stored in AuditLog and EventChange payload
//
// Security:
//   - `event_decision.scope_override` policy: WHOLESALER_ADMIN /
//     WHOLESALER_EVENT_TEAM only.
//   - Cross-tenant defence: Event.wholesalerId must match ctx.wholesalerId.
//   - EventDealer must exist (event + relationship pair validated before write).

import { z } from "zod";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const DealerScopeSchema = z.enum(["APPOINTMENT_ONLY", "FIRST_VISIT", "FULL_CLOSING"]);

// 「"use server"」ファイルは async function 以外 export 不可（Next.js 制約）。
const ScopeOverrideInputSchema = z.object({
  eventId: z.string().min(1, "イベント ID が必要です"),
  relationshipId: z.string().min(1, "担当二次店 (関係 ID) が必要です"),
  scopeOverride: DealerScopeSchema.nullable(),
  reason: z.string().trim().min(1, "変更理由を入力してください").max(2000),
});

type ScopeOverrideInput = z.infer<typeof ScopeOverrideInputSchema>;

interface ScopeOverrideResult {
  eventId: string;
  relationshipId: string;
  scopeOverride: string | null;
}

export const updateScopeOverrideAction = withServerActionContext<
  ScopeOverrideInput,
  ScopeOverrideResult
>(
  {
    action: "event_decision.scope_override",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for scope override");
    }

    const parsed = ScopeOverrideInputSchema.parse(input);

    // Verify the Event exists and belongs to this wholesaler.
    const event = await tx.event.findUnique({
      where: { id: parsed.eventId },
      select: { id: true, wholesalerId: true },
    });
    if (!event) {
      throw new NotFoundError("イベントが見つかりません");
    }
    if (event.wholesalerId !== ctx.wholesalerId) {
      throw new NotFoundError("イベントが見つかりません");
    }

    // Verify the EventDealer row exists (event + relationship pair).
    const eventDealer = await tx.eventDealer.findUnique({
      where: {
        eventId_relationshipId: {
          eventId: parsed.eventId,
          relationshipId: parsed.relationshipId,
        },
      },
      select: { scopeOverride: true },
    });
    if (!eventDealer) {
      throw new NotFoundError("指定した担当二次店がこのイベントに存在しません");
    }

    const before = eventDealer.scopeOverride;
    const after = parsed.scopeOverride;

    // Update EventDealer.scopeOverride.
    await tx.eventDealer.update({
      where: {
        eventId_relationshipId: {
          eventId: parsed.eventId,
          relationshipId: parsed.relationshipId,
        },
      },
      data: { scopeOverride: after },
    });

    // EventChange — preserves the before/after diff for the event timeline.
    await tx.eventChange.create({
      data: {
        eventId: parsed.eventId,
        before: { type: "SCOPE_OVERRIDE", scopeOverride: before, relationshipId: parsed.relationshipId },
        after: {
          type: "SCOPE_OVERRIDE",
          scopeOverride: after,
          relationshipId: parsed.relationshipId,
          reason: parsed.reason,
        },
        changedBy: ctx.actorUserId,
      },
    });

    // AuditLog — docs/02 §F-024 受入基準「上書き変更は監査ログに残る」
    // ctx.wholesalerId is already verified non-null above (ValidationError guard).
    await tx.auditLog.create({
      data: {
        actorUserId: ctx.actorUserId,
        tenantId: ctx.wholesalerId!,
        targetType: "EventDealer",
        targetId: `${parsed.eventId}:${parsed.relationshipId}`,
        action: "UPDATE",
        before: { scopeOverride: before },
        after: { scopeOverride: after, reason: parsed.reason },
      },
    });

    return {
      eventId: parsed.eventId,
      relationshipId: parsed.relationshipId,
      scopeOverride: after,
    };
  },
);
