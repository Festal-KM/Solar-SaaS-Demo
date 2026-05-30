// S-041 — 卸業者 契約詳細統合表示 (T-05-09 / F-040 / F-041 / F-042 /
// docs/04 §1.3).
//
// 契約基本情報 + 明細テーブル（仕入値含む）+ 粗利カード + 施工状況 +
// 補助金申請 + インセンティブ placeholder（SP-06 で接続）を 1 ページに統合。

import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { getContractDetail } from "../data";
import { CancelContractDialog } from "./cancel/CancelContractDialog";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function WholesalerContractDetailPage({ params }: PageProps) {
  const { id } = await params;
  const contract = await getContractDetail(id);
  if (!contract) notFound();

  const t = labels.contract;
  const ti = labels.contractItem;
  const tg = labels.grossProfit;
  const ta = labels.application;
  const c = labels.common;
  const bc = labels.breadcrumb.items;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.contracts, href: "/contracts" },
          { label: bc.contractDetail },
        ]}
      />
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/contracts">{c.back}</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t.detailTitle}</h1>
        {contract.status !== "CANCELLED" && contract.status !== "DONE" && (
          <div className="ml-auto">
            <CancelContractDialog
              contractId={contract.id}
              cancelDeadline={new Date(contract.cancelDeadline)}
            />
          </div>
        )}
      </div>

      {/* Basic info */}
      <div className="border-border rounded-md border p-4 space-y-3">
        <h2 className="font-medium">{t.sections.basic}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t.fields.customer}</dt>
          <dd>
            <Link
              href={`/customers/${contract.customerId}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {contract.customerName}
            </Link>
          </dd>

          <dt className="text-muted-foreground">{t.fields.deal}</dt>
          <dd>
            <Link
              href={`/deals/${contract.dealId}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {t.detail.dealLink}
            </Link>
          </dd>

          <dt className="text-muted-foreground">{t.fields.contractDate}</dt>
          <dd>{new Date(contract.contractDate).toLocaleDateString("ja-JP")}</dd>

          <dt className="text-muted-foreground">{t.fields.totalAmount}</dt>
          <dd>
            {Number(contract.contractAmount).toLocaleString("ja-JP")} {c.currencySuffix}
          </dd>

          <dt className="text-muted-foreground">{t.fields.cancelDeadline}</dt>
          <dd>{new Date(contract.cancelDeadline).toLocaleDateString("ja-JP")}</dd>

          <dt className="text-muted-foreground">{t.fields.status}</dt>
          <dd>
            <span className={contract.status === "CANCELLED" ? "text-destructive" : undefined}>
              {t.statuses[contract.status]}
            </span>
          </dd>

          {contract.isSelfHosted && (
            <>
              <dt className="text-muted-foreground">{t.fields.isSelfHosted}</dt>
              <dd className="text-amber-600">{t.detail.selfHostedBadge}</dd>
            </>
          )}

          {contract.incentiveRateSnapshot && (
            <>
              <dt className="text-muted-foreground">{t.fields.incentiveRateSnapshot}</dt>
              <dd>{contract.incentiveRateSnapshot} %</dd>
            </>
          )}

          {contract.incentiveTargetTypeSnapshot && (
            <>
              <dt className="text-muted-foreground">{t.fields.incentiveTargetTypeSnapshot}</dt>
              <dd>{tg.incentiveTargetTypes[contract.incentiveTargetTypeSnapshot as keyof typeof tg.incentiveTargetTypes] ?? contract.incentiveTargetTypeSnapshot}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Items section */}
      <div className="border-border rounded-md border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{t.sections.items}</h2>
          <Button asChild variant="outline" size="sm">
            <Link href={`/contracts/${id}/items`}>{t.actions.goToItems}</Link>
          </Button>
        </div>
        {contract.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.detail.noItems}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{ti.columns.productName}</th>
                  <th className="px-3 py-2 font-medium">{ti.columns.maker}</th>
                  <th className="px-3 py-2 font-medium">{ti.columns.qty}</th>
                  <th className="px-3 py-2 font-medium">{ti.columns.unit}</th>
                  <th className="px-3 py-2 font-medium">{ti.columns.purchasePrice}</th>
                  <th className="px-3 py-2 font-medium">{ti.columns.dealerPrice}</th>
                  <th className="px-3 py-2 font-medium">{ti.columns.listPrice}</th>
                  <th className="px-3 py-2 font-medium">{ti.columns.subtotal}</th>
                </tr>
              </thead>
              <tbody>
                {contract.items.map((item) => (
                  <tr key={item.id} className="border-border border-t">
                    <td className="px-3 py-2">{item.productName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.maker}</td>
                    <td className="px-3 py-2">{item.qty}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.unit}</td>
                    <td className="px-3 py-2">
                      {Number(item.snapshotPurchasePrice).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {Number(item.snapshotDealerPrice).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {Number(item.snapshotListPrice).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {Number(item.subtotal).toLocaleString("ja-JP")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Gross profit section */}
      <div className="border-border rounded-md border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{t.sections.grossProfit}</h2>
          <Button asChild variant="outline" size="sm">
            <Link href={`/contracts/${id}/gross-profit`}>{t.actions.goToGrossProfit}</Link>
          </Button>
        </div>
        {!contract.grossProfit ? (
          <p className="text-sm text-muted-foreground">{t.detail.noGrossProfit}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{tg.fields.salesPrice}</dt>
            <dd>
              {Number(contract.grossProfit.salesPrice).toLocaleString("ja-JP")} {c.currencySuffix}
            </dd>
            <dt className="text-muted-foreground">{tg.fields.purchaseTotal}</dt>
            <dd>
              {Number(contract.grossProfit.purchaseTotal).toLocaleString("ja-JP")} {c.currencySuffix}
            </dd>
            <dt className="text-muted-foreground">{tg.fields.dealerTotal}</dt>
            <dd>
              {Number(contract.grossProfit.dealerTotal).toLocaleString("ja-JP")} {c.currencySuffix}
            </dd>
            <dt className="text-muted-foreground">{tg.fields.projectProfit}</dt>
            <dd className="font-medium">
              {Number(contract.grossProfit.projectProfit).toLocaleString("ja-JP")} {c.currencySuffix}
            </dd>
            <dt className="text-muted-foreground">{tg.fields.wholesaleProfit}</dt>
            <dd>
              {Number(contract.grossProfit.wholesaleProfit).toLocaleString("ja-JP")} {c.currencySuffix}
            </dd>
            <dt className="text-muted-foreground">{tg.fields.profitRate}</dt>
            <dd>
              {(Number(contract.grossProfit.profitRate) * 100).toFixed(1)} %
            </dd>
            <dt className="text-muted-foreground">{tg.fields.incentiveTargetType}</dt>
            <dd>
              {tg.incentiveTargetTypes[contract.grossProfit.incentiveTargetType as keyof typeof tg.incentiveTargetTypes] ?? contract.grossProfit.incentiveTargetType}
            </dd>
            <dt className="text-muted-foreground">{tg.fields.incentiveTargetProfit}</dt>
            <dd>
              {Number(contract.grossProfit.incentiveTargetProfit).toLocaleString("ja-JP")} {c.currencySuffix}
            </dd>
          </dl>
        )}
      </div>

      {/* Constructions section */}
      <div className="border-border rounded-md border p-4 space-y-3">
        <h2 className="font-medium">{t.sections.constructions}</h2>
        {contract.constructions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.detail.noConstructions}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {contract.constructions.map((con) => (
              <li key={con.id} className="flex gap-4">
                <span className="text-muted-foreground">{con.status}</span>
                {con.plannedDate && (
                  <span>{new Date(con.plannedDate).toLocaleDateString("ja-JP")}</span>
                )}
                {con.fee && (
                  <span>
                    {Number(con.fee).toLocaleString("ja-JP")} {c.currencySuffix}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Applications section */}
      <div className="border-border rounded-md border p-4 space-y-3">
        <h2 className="font-medium">{t.sections.applications}</h2>
        {contract.applications.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.detail.noApplications}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {contract.applications.map((app) => (
              <li key={app.id} className="flex gap-4">
                <span className="font-medium">{app.type}</span>
                <span className="text-muted-foreground">{app.status}</span>
                {app.expectedAmount && (
                  <span>
                    {ta.estimatedPrefix}: {Number(app.expectedAmount).toLocaleString("ja-JP")} {c.currencySuffix}
                  </span>
                )}
                {app.grantedAmount && (
                  <span>
                    {ta.confirmedPrefix}: {Number(app.grantedAmount).toLocaleString("ja-JP")} {c.currencySuffix}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Incentive section */}
      <div className="border-border rounded-md border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{t.sections.incentive}</h2>
          <Button asChild variant="outline" size="sm">
            <Link href={`/contracts/${id}/incentive`}>{t.actions.goToIncentive}</Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t.detail.incentiveNote}</p>
      </div>
    </div>
  );
}
