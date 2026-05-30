import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";

import { listActiveVenueProviders } from "../data";
import { EventCandidateForm } from "../event-candidate-form";

// S-024 — イベント候補の新規登録. ページ自体で `event_candidate.create` を
// assertCan するので、二次店ロールが URL を直叩きしても 403。

export const dynamic = "force-dynamic";

export default async function NewEventCandidatePage() {
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
    action: "event_candidate.create",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });

  const venueProviders = await listActiveVenueProviders();
  const t = labels.eventCandidate;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.new}</h1>
      <EventCandidateForm mode={{ kind: "create" }} venueProviders={venueProviders} />
    </div>
  );
}
