// Server-side data loader for the event-decision screen (T-03-08 / F-023 /
// docs/04 §S-027). Fetches the EventCandidate header plus the list of active
// Relationships for the dealer-picker, and the preference summary (who has
// submitted) for the decision hints panel.

import "server-only";

import { auth } from "@/auth";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface EventCandidateDecideHeader {
  id: string;
  wholesalerId: string;
  storeName: string;
  area: string | null;
  targetMonth: string;
  scheduledDate: string;
  deadlineAt: string;
  status: string;
}

export interface RelationshipOption {
  relationshipId: string;
  dealerId: string;
  dealerName: string;
  hasPreference: boolean;
}

export interface EventDecidePageData {
  candidate: EventCandidateDecideHeader;
  relationships: RelationshipOption[];
}

async function requireDecideCtx() {
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
    action: "event_decision.decide",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export async function getEventDecidePageData(
  eventCandidateId: string,
): Promise<EventDecidePageData> {
  const ctx = await requireDecideCtx();

  return withTenant(ctx, async (tx) => {
    const candidate = await tx.eventCandidate.findUnique({
      where: { id: eventCandidateId },
      select: {
        id: true,
        wholesalerId: true,
        storeName: true,
        area: true,
        targetMonth: true,
        scheduledDate: true,
        deadlineAt: true,
        status: true,
      },
    });
    if (!candidate) {
      throw new NotFoundError("イベント候補が見つかりません");
    }
    if (!ctx.isSaasAdmin && ctx.wholesalerId !== candidate.wholesalerId) {
      throw new NotFoundError("イベント候補が見つかりません");
    }

    // All active relationships for the dealer-picker.
    const rels = await tx.relationship.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        dealerId: true,
        dealer: { select: { name: true } },
      },
    });

    // Which relationships have already submitted a preference?
    const prefRows =
      rels.length > 0
        ? await tx.dealerPreference.findMany({
            where: {
              eventCandidateId,
              relationshipId: { in: rels.map((r) => r.id) },
            },
            select: { relationshipId: true },
          })
        : [];
    const submittedRelIds = new Set(prefRows.map((p) => p.relationshipId));

    return {
      candidate: {
        id: candidate.id,
        wholesalerId: candidate.wholesalerId,
        storeName: candidate.storeName,
        area: candidate.area,
        targetMonth: candidate.targetMonth,
        scheduledDate: candidate.scheduledDate.toISOString(),
        deadlineAt: candidate.deadlineAt.toISOString(),
        status: candidate.status,
      },
      relationships: rels.map((r) => ({
        relationshipId: r.id,
        dealerId: r.dealerId,
        dealerName: r.dealer.name,
        hasPreference: submittedRelIds.has(r.id),
      })),
    };
  });
}
