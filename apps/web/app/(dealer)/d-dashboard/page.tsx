// S-058 — 二次店ダッシュボード (docs/04 §1.5).
//
// 二次店ロール (dealer_admin / dealer_staff) の共通ホーム。
// 今日のイベント・マエカク未対応・今月の契約件数を KPI カードで表示。

import Link from "next/link";

import { auth } from "@/auth";
import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@solar/db";

export const dynamic = "force-dynamic";

async function getDealerDashboardSummary() {
  const ctx = await getTenantContext();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [todayEventCount, monthlyContractCount, pendingPreCallCount] = await Promise.all([
    withTenant(ctx, (tx) =>
      tx.event.count({
        where: {
          eventCandidate: {
            scheduledDate: { gte: todayStart, lt: todayEnd },
          },
          dealers: {
            some: {
              relationshipId: { in: ctx.relationshipIds },
            },
          },
        },
      }),
    ),
    withTenant(ctx, (tx) =>
      tx.contract.count({
        where: {
          contractDate: { gte: monthStart, lt: monthEnd },
          ownerRelationshipId: { in: ctx.relationshipIds },
        },
      }),
    ),
    withTenant(ctx, (tx) =>
      tx.preCallNotification.count({
        where: {
          relationshipId: { in: ctx.relationshipIds },
          status: "SENT",
        },
      }),
    ),
  ]);

  return { todayEventCount, monthlyContractCount, pendingPreCallCount };
}

export default async function DealerDashboardPage() {
  const session = await auth();
  if (!session?.user) return null;

  const summary = await getDealerDashboardSummary();
  const t = labels.dealerDashboard;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-medium text-carbon-dark">{t.title}</h1>
        <p className="text-pewter text-sm mt-1">{t.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card data-section="today-events" className="p-6">
          <p className="text-pewter text-sm">{t.sections.todayEvents.title}</p>
          <p className="text-carbon-dark text-3xl font-medium tabular-nums mt-2">
            {summary.todayEventCount}
          </p>
          <Link
            href="/d-events"
            className="text-electric-blue text-xs mt-3 inline-block hover:underline underline-offset-4"
          >
            {t.sections.todayEvents.cta}
          </Link>
        </Card>

        <Card data-section="pending-precall" className="p-6">
          <p className="text-pewter text-sm">{t.sections.pendingPreCall.title}</p>
          <p className="text-carbon-dark text-3xl font-medium tabular-nums mt-2">
            {summary.pendingPreCallCount}
            <span className="text-pewter ml-1 text-sm font-normal">
              {t.sections.pendingPreCall.unitSuffix}
            </span>
          </p>
          <p className="text-pewter text-xs mt-2">{t.sections.pendingPreCall.description}</p>
          <Link
            href="/d-appointments"
            className="text-electric-blue text-xs mt-3 inline-block hover:underline underline-offset-4"
          >
            {t.sections.pendingPreCall.cta}
          </Link>
        </Card>

        <Card data-section="monthly-contracts" className="p-6">
          <p className="text-pewter text-sm">{t.sections.monthlyContracts.title}</p>
          <p className="text-carbon-dark text-3xl font-medium tabular-nums mt-2">
            {summary.monthlyContractCount}
            <span className="text-pewter ml-1 text-sm font-normal">
              {t.sections.monthlyContracts.unitSuffix}
            </span>
          </p>
          <Link
            href="/d-contracts"
            className="text-electric-blue text-xs mt-3 inline-block hover:underline underline-offset-4"
          >
            {t.sections.monthlyContracts.cta}
          </Link>
        </Card>
      </div>
    </div>
  );
}
