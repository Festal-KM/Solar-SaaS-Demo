// S-040 (new) — 卸業者側 契約新規登録フォーム (T-05-12 / F-040 / docs/04 §1.3).
//
// URL: /contracts/new?dealId=<id>
//
// 前提: 商談が LIKELY_CONTRACT 状態であること（アクション層でバリデーション）。
// 登録後は /contracts/<newId> へ遷移する。
// cancelDeadline と incentiveRateSnapshot はサーバー側で自動計算される。

import { redirect } from "next/navigation";
import Link from "next/link";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { createContractAction } from "../actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ dealId?: string }>;
}

export default async function NewContractPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const dealId = params.dealId ?? "";

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
    action: "contract.create",
  });

  // Load deal for display.
  let dealCustomerName = "";
  let dealStatus = "";
  if (dealId && ctx.wholesalerId) {
    const row = await withTenant(ctx, (tx) =>
      tx.deal.findFirst({
        where: { id: dealId, customer: { wholesalerId: ctx.wholesalerId! } },
        select: { status: true, customer: { select: { name: true } } },
      }),
    );
    dealCustomerName = row?.customer?.name ?? "";
    dealStatus = row?.status ?? "";
  }

  const t = labels.contract;
  const c = labels.common;

  // ISO date string for today (JST — using UTC as a fallback is acceptable
  // for the test environment).
  const todayIso = new Date().toISOString().slice(0, 10);

  async function handleCreate(formData: FormData) {
    "use server";
    const did = (formData.get("dealId") as string) || "";
    const rawDate = (formData.get("contractDate") as string) || "";
    const rawAmount = (formData.get("totalAmount") as string) || "0";
    const isSelfHosted = formData.get("isSelfHosted") === "true";

    // Convert YYYY-MM-DD to ISO datetime
    const contractDate = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();

    const result = await createContractAction({
      dealId: did,
      contractDate,
      totalAmount: rawAmount,
      isSelfHosted,
    });
    redirect(`/contracts/${result.id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {dealId && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/deals/${dealId}`}>{c.back}</Link>
          </Button>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{t.new}</h1>
      </div>

      {!dealId ? (
        <p className="text-destructive text-sm">商談 ID を指定してください (?dealId=...)</p>
      ) : (
        <form action={handleCreate} className="space-y-4 max-w-lg">
          <input type="hidden" name="dealId" value={dealId} />

          {/* Deal info */}
          <div className="border-border rounded-md border p-4 space-y-1">
            <p className="text-sm text-muted-foreground">{t.fields.deal}</p>
            <p className="font-medium">{dealCustomerName}</p>
            <p className="text-xs text-muted-foreground">ステータス: {dealStatus}</p>
          </div>

          {/* Contract date */}
          <div className="space-y-1">
            <label htmlFor="contractDate" className="text-sm font-medium">
              {t.fields.contractDate}
            </label>
            <input
              id="contractDate"
              name="contractDate"
              type="date"
              defaultValue={todayIso}
              required
              className="block rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          {/* Total amount */}
          <div className="space-y-1">
            <label htmlFor="totalAmount" className="text-sm font-medium">
              {t.fields.totalAmount}
            </label>
            <input
              id="totalAmount"
              name="totalAmount"
              type="number"
              min={0}
              step={1}
              defaultValue={0}
              required
              className="block w-48 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          {/* isSelfHosted */}
          <div className="flex items-center gap-2">
            <input
              id="isSelfHosted"
              name="isSelfHosted"
              type="checkbox"
              value="true"
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="isSelfHosted" className="text-sm">
              {t.fields.isSelfHosted}
            </label>
          </div>

          <Button type="submit">{t.actions.createSubmit}</Button>
        </form>
      )}
    </div>
  );
}
