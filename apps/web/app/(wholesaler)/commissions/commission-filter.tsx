"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import type { DealerOption, PaymentStatus } from "./data";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-hairline-light bg-white px-3 py-1 text-sm text-body-light focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";

const PAYMENT_OPTIONS: PaymentStatus[] = ["unpaid", "partial", "paid"];

interface CommissionFilterProps {
  dealers: DealerOption[];
  targetMonth: string;
  dealerId: string;
  paymentStatus: string;
}

export function CommissionFilter({
  dealers,
  targetMonth,
  dealerId,
  paymentStatus,
}: CommissionFilterProps) {
  const router = useRouter();
  const t = labels.commission.listPage;

  // Local-only state; nothing is applied to the URL until 検索 is clicked.
  const [monthValue, setMonthValue] = useState(targetMonth);
  const [dealerValue, setDealerValue] = useState(dealerId);
  const [statusValue, setStatusValue] = useState(paymentStatus);

  function applyFilters() {
    const params = new URLSearchParams();
    if (monthValue) params.set("targetMonth", monthValue);
    if (dealerValue) params.set("dealerId", dealerValue);
    if (statusValue) params.set("paymentStatus", statusValue);
    const qs = params.toString();
    router.push(qs ? `/commissions?${qs}` : "/commissions");
  }

  function clearFilters() {
    setMonthValue("");
    setDealerValue("");
    setStatusValue("");
    router.push("/commissions");
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        applyFilters();
      }}
    >
      <div className="space-y-1">
        <label className="text-xs font-medium text-mute-light">{t.filter.targetMonth}</label>
        <input
          type="month"
          value={monthValue}
          onChange={(e) => setMonthValue(e.target.value)}
          className={`${SELECT_CLASS} w-[160px]`}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-mute-light">{t.filter.dealer}</label>
        <select
          value={dealerValue}
          onChange={(e) => setDealerValue(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t.filter.allDealers}</option>
          {dealers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.dealerName}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-mute-light">{t.filter.paymentStatus}</label>
        <select
          value={statusValue}
          onChange={(e) => setStatusValue(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t.filter.all}</option>
          {PAYMENT_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t.paymentStatusLabels[s]}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit">
        <Search className="size-4" />
        {t.filter.search}
      </Button>
      <Button type="button" variant="outline" onClick={clearFilters}>
        {t.filter.clear}
      </Button>

      <Button type="button" variant="outline" className="ml-auto" disabled>
        {t.filter.csvExport}
      </Button>
    </form>
  );
}
