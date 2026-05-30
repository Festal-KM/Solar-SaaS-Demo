// S-038 — 卸業者側 商談詳細 + ステータス変更 (T-05-03 / F-038 / docs/04 §1.3).
//
// 商談の基本情報を表示し、有効なステータス遷移ボタンを表示する。
// ステータス変更は changeStatusAction を呼ぶ form action で行う。

import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";
import { getDeal } from "../data";
import { changeStatusAction } from "../actions";

import {
  DEAL_ALLOWED_TRANSITIONS,
  DEAL_TERMINAL_STATUSES,
  type DealStatus,
} from "@solar/contracts";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function WholesalerDealDetailPage({ params }: PageProps) {
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) notFound();

  const t = labels.deal;
  const c = labels.common;
  const bc = labels.breadcrumb.items;

  const allowedNext = [...DEAL_ALLOWED_TRANSITIONS[deal.status]];
  const isTerminal = DEAL_TERMINAL_STATUSES.has(deal.status);

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.deals, href: "/deals" },
          { label: bc.dealDetail },
        ]}
      />
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/deals">{c.back}</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t.detailTitle}</h1>
      </div>

      {/* Basic info */}
      <div className="border-border rounded-md border p-4 space-y-3">
        <h2 className="font-medium">{t.sections.basic}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t.fields.customer}</dt>
          <dd>
            <Link
              href={`/customers/${deal.customerId}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {deal.customerName}
            </Link>
          </dd>

          <dt className="text-muted-foreground">{t.fields.status}</dt>
          <dd>{t.statuses[deal.status]}</dd>

          <dt className="text-muted-foreground">{t.fields.ownerType}</dt>
          <dd>{t.ownerTypes[deal.ownerType]}</dd>

          {deal.firstVisitAt && (
            <>
              <dt className="text-muted-foreground">{t.fields.firstVisitAt}</dt>
              <dd>{new Date(deal.firstVisitAt).toLocaleDateString("ja-JP")}</dd>
            </>
          )}

          {deal.proposedProduct && (
            <>
              <dt className="text-muted-foreground">{t.fields.proposedProduct}</dt>
              <dd>{deal.proposedProduct}</dd>
            </>
          )}

          {deal.proposedAmount && (
            <>
              <dt className="text-muted-foreground">{t.fields.proposedAmount}</dt>
              <dd>{Number(deal.proposedAmount).toLocaleString("ja-JP")} {c.currencySuffix}</dd>
            </>
          )}

          {deal.expectedContractDate && (
            <>
              <dt className="text-muted-foreground">{t.fields.expectedContractDate}</dt>
              <dd>{new Date(deal.expectedContractDate).toLocaleDateString("ja-JP")}</dd>
            </>
          )}

          {deal.nextAction && (
            <>
              <dt className="text-muted-foreground">{t.fields.nextAction}</dt>
              <dd>{deal.nextAction}</dd>
            </>
          )}

          {deal.lostReason && (
            <>
              <dt className="text-muted-foreground">{t.fields.lostReason}</dt>
              <dd className="text-destructive">{deal.lostReason}</dd>
            </>
          )}

          {deal.note && (
            <>
              <dt className="text-muted-foreground">{t.fields.note}</dt>
              <dd className="whitespace-pre-wrap">{deal.note}</dd>
            </>
          )}

          <dt className="text-muted-foreground">{t.fields.createdAt}</dt>
          <dd>{new Date(deal.createdAt).toLocaleDateString("ja-JP")}</dd>
        </dl>
      </div>

      {/* Status transition */}
      {!isTerminal && allowedNext.length > 0 && (
        <div className="border-border rounded-md border p-4 space-y-3">
          <h2 className="font-medium">{t.sections.statusChange}</h2>
          <div className="flex flex-wrap gap-2">
            {allowedNext.map((nextStatus) => (
              <form
                key={nextStatus}
                action={async () => {
                  "use server";
                  await changeStatusAction({ id: deal.id, status: nextStatus as DealStatus });
                }}
              >
                <Button
                  type="submit"
                  variant={nextStatus === "LOST" ? "destructive" : "default"}
                  size="sm"
                >
                  {t.statuses[nextStatus as DealStatus]}
                </Button>
              </form>
            ))}
          </div>
        </div>
      )}

      {isTerminal && (
        <p className="text-muted-foreground text-sm">{t.terminalNotice}</p>
      )}
    </div>
  );
}
