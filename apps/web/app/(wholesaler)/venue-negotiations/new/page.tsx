import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";

import { listActiveVenueProviders } from "../data";
import { VenueNegotiationForm } from "../venue-negotiation-form";

// S-022 — 場所提供元対応の新規起票. ページ自体で `venue_negotiation.create`
// を assertCan するので、二次店ロールが URL を直叩きしても 403。

export const dynamic = "force-dynamic";

export default async function NewVenueNegotiationPage() {
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
    action: "venue_negotiation.create",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });

  const venueProviders = await listActiveVenueProviders();
  const t = labels.venueNegotiation;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.new}</h1>
      <VenueNegotiationForm mode={{ kind: "create" }} venueProviders={venueProviders} />
    </div>
  );
}
