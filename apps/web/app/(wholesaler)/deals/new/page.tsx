// S-037 (new) — 卸業者側 商談新規登録フォーム (T-05-12 / F-038 / docs/04 §1.3).
//
// URL: /deals/new?customerId=<id>
//
// 最小実装: customerId を query param から取得し、createDealAction を呼ぶ。
// 担当者 ID はサーバー側で ctx.actorUserId を使うため入力不要。
// 登録後は /deals/<newId> へ遷移する。

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { createDealAction } from "../actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ customerId?: string }>;
}

export default async function NewDealPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const customerId = params.customerId ?? "";

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
    action: "deal.create",
  });

  // Resolve customer name for display.
  let customerName = "";
  if (customerId && ctx.wholesalerId) {
    const row = await withTenant(ctx, (tx) =>
      tx.customer.findFirst({
        where: { id: customerId, wholesalerId: ctx.wholesalerId! },
        select: { name: true },
      }),
    );
    customerName = row?.name ?? "";
  }

  const t = labels.deal;

  async function handleCreate(formData: FormData) {
    "use server";
    const cid = (formData.get("customerId") as string) || "";
    const notes = (formData.get("notes") as string) || undefined;
    const actorId = (formData.get("actorUserId") as string) || "system";

    const result = await createDealAction({
      customerId: cid,
      assignedToUserId: actorId,
      notes,
    });
    redirect(`/deals/${result.id}`);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.new}</h1>

      {!customerId ? (
        <p className="text-destructive text-sm">顧客 ID を指定してください (?customerId=...)</p>
      ) : (
        <form action={handleCreate} className="space-y-4 max-w-lg">
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="actorUserId" value={ctx.actorUserId} />

          {/* Customer display */}
          <div className="border-border rounded-md border p-4 space-y-1">
            <p className="text-sm text-muted-foreground">{t.fields.customer}</p>
            <p className="font-medium">{customerName || customerId}</p>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label htmlFor="notes" className="text-sm font-medium">
              {t.fields.note}
              <span className="text-muted-foreground ml-1">{labels.common.optional}</span>
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          <Button type="submit">{labels.common.create}</Button>
        </form>
      )}
    </div>
  );
}
