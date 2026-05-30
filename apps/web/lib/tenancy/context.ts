// `getTenantContext()` — Server Action / Route Handler boundary helper
// (T-01-08, docs/05 §6.6).
//
// Pulls the Auth.js v5 session, fails fast with `UnauthorizedError` if the
// caller is unauthenticated, then rehydrates the `TenantContext` consumed by
// `withTenant()` (docs/05 §3.9, packages/db/src/with-tenant.ts).
//
// Dealer members need their visible relationship ids resolved with one DB
// round-trip; the lookup runs as SaaS-admin against the raw client because:
//   1. The Relationship row is the very thing that scopes the dealer; we can't
//      use RLS to fetch it without already knowing it.
//   2. Returning an empty list quietly is a foot-gun — the caller would think
//      the dealer has no active wholesalers when in fact they are blocked.
//
// Wholesaler members read their wholesalerId straight off the session JWT —
// no DB call needed.

import { UnauthorizedError } from "@solar/auth";
import { rawPrisma, type TenantContext } from "@solar/db";

import { auth } from "@/auth";

export async function getTenantContext(): Promise<TenantContext> {
  const session = await auth();

  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
    });
  }

  const {
    id: actorUserId,
    tenantType,
    tenantId,
    wholesalerId,
    dealerId,
    isSaasAdmin,
  } = session.user;

  // SaaS operator — bypass RLS entirely. No tenant scoping, no relationship
  // lookups. The caller still has to pass an `assertCan()` check before any
  // sensitive operation.
  if (isSaasAdmin) {
    return {
      actorUserId,
      isSaasAdmin: true,
      relationshipIds: [],
    };
  }

  if (tenantType === "WHOLESALER") {
    if (!wholesalerId) {
      throw new UnauthorizedError({
        code: "INVALID_CREDENTIALS",
        message: "Wholesaler session missing wholesalerId",
      });
    }
    return {
      actorUserId,
      tenantId,
      wholesalerId,
      relationshipIds: [],
      isSaasAdmin: false,
    };
  }

  // Dealer member — resolve relationships under the active wholesaler context.
  // Multi-wholesaler dealers carry a `wholesalerId` selected via the tenant
  // switcher (S-011). When no wholesaler is selected yet, scope to *all*
  // active relationships the dealer is party to so the upcoming switcher UI
  // can still render the option list.
  if (!dealerId) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Dealer session missing dealerId",
    });
  }

  const relationships = await rawPrisma.relationship.findMany({
    where: {
      dealerId,
      status: "ACTIVE",
      ...(wholesalerId ? { wholesalerId } : {}),
    },
    select: { id: true },
  });
  const relationshipIds = relationships.map((r) => r.id);

  return {
    actorUserId,
    tenantId,
    dealerId,
    wholesalerId: wholesalerId ?? undefined,
    relationshipIds,
    isSaasAdmin: false,
  };
}
