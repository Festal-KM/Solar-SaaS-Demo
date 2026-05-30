import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { getIncentiveRate } from "../data";
import { IncentiveRateForm } from "../incentive-rate-form";

// インセンティブ率マスタ 詳細・編集 (S-052 sub / F-014). `getIncentiveRate` は
// auth → assertCan(incentive_rate.read) → withTenant の三段を通り、クロステナント
// id は RLS で null になり 404。フォーム本体は update Server Action を呼ぶため、
// dealer / non-admin wholesaler ロールはサブミット時に 403 になる
// （read だけ通って書き込めない、というのが期待挙動）。

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function IncentiveRateDetailPage({ params }: PageProps) {
  const { id } = await params;
  const row = await getIncentiveRate(id);
  if (!row) {
    notFound();
  }

  const t = labels.incentiveRate;
  const bc = labels.breadcrumb.items;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.masters, href: "/masters" },
          { label: bc.masterIncentiveRates, href: "/masters/incentive-rates" },
          { label: bc.masterIncentiveRateDetail },
        ]}
      />
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/masters/incentive-rates">{labels.common.back}</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t.edit}</h1>
      </div>
      <IncentiveRateForm
        mode={{
          kind: "edit",
          id: row.id,
          dealerName: row.dealerName,
          targetType: row.targetType,
          effectiveFrom: row.effectiveFrom,
          initial: {
            rate: row.rate,
            effectiveTo: row.effectiveTo ? row.effectiveTo.slice(0, 10) : "",
            note: row.note ?? "",
          },
        }}
      />
    </div>
  );
}
