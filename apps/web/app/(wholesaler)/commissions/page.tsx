// 手数料一覧 — F-? 二次店ごとの手数料を一覧表示する。
//
// SAMPLE / PLACEHOLDER data only — backed by ./data (in-memory sample). Real
// figures will come from the incentive → commission aggregation as a follow-up.

import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

import { CommissionAccordion } from "./commission-accordion";
import { CommissionFilter } from "./commission-filter";
import { listCommissionDealers, listCommissions, type PaymentStatus } from "./data";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    targetMonth?: string;
    dealerId?: string;
    paymentStatus?: string;
  }>;
}

const VALID_STATUS: PaymentStatus[] = ["unpaid", "partial", "paid"];

export default async function CommissionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const t = labels.commission;
  const lp = t.listPage;

  const targetMonth =
    params.targetMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.targetMonth)
      ? params.targetMonth
      : "";
  const dealerId = params.dealerId?.trim() ?? "";
  const paymentStatus = VALID_STATUS.includes(params.paymentStatus as PaymentStatus)
    ? (params.paymentStatus as PaymentStatus)
    : "";

  const dealers = listCommissions({
    targetMonth: targetMonth || undefined,
    dealerId: dealerId || undefined,
    paymentStatus: paymentStatus || undefined,
  });
  const dealerOptions = listCommissionDealers();

  const total = dealers.length;
  const rangeText = lp.rangeOf
    .replace("{start}", total === 0 ? "0" : "1")
    .replace("{end}", String(total))
    .replace("{total}", String(total));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{t.list.title}</h1>
        <p className="mt-1 text-sm text-body-light">{t.list.subtitle}</p>
      </div>

      <Card className="p-4">
        <CommissionFilter
          dealers={dealerOptions}
          targetMonth={targetMonth}
          dealerId={dealerId}
          paymentStatus={paymentStatus}
        />
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-hairline-light px-6 py-4">
          <h2 className="text-sm font-medium text-ink">{lp.sectionTitle}</h2>
          <span className="text-xs tabular-nums text-mute-light">
            {total}
            {lp.resultCount}
          </span>
        </div>

        {/* Bulk toolbar + column headers now live inside CommissionAccordion. */}
        {total === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-mute-light">{lp.empty}</div>
        ) : (
          <CommissionAccordion dealers={dealers} />
        )}
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-end">
          <span className="text-sm tabular-nums text-mute-light">{rangeText}</span>
        </div>
      )}
    </div>
  );
}
