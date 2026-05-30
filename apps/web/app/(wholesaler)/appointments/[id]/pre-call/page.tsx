// S-035 — マエカク管理ページ (T-04-09 / F-035 / docs/04 §1.3).
//
// Accessible only to WHOLESALER_ADMIN and WHOLESALER_CALL_TEAM.
// Dealers are blocked at the data layer (pre_call.read assertCan) and by
// middleware routing — this page lives under (wholesaler) which already
// requires wholesaler roles.
//
// Layout:
//   - アポ概要 (顧客名 / 訪問予定日時 / 現在ステータス)
//   - マエカク未記録: form (PreCallForm)
//   - マエカク記録済み: 記録詳細の読み取り表示

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { recordPreCallAction } from "./actions";
import { getAppointmentWithPreCall } from "./data";
import { PreCallForm } from "./pre-call-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PreCallPage({ params }: PageProps) {
  const { id } = await params;
  const data = await getAppointmentWithPreCall(id);

  const t = labels.preCall;
  const ta = labels.appointment;
  const bc = labels.breadcrumb.items;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.appointments, href: "/appointments" },
          { label: bc.appointmentPreCall },
        ]}
      />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <Button asChild variant="outline" size="sm">
          <Link href={`/appointments`}>{t.backToAppointment}</Link>
        </Button>
      </div>

      {/* アポ概要 */}
      <div className="border-border rounded-md border p-4">
        <h2 className="mb-3 text-base font-medium">{ta.sections.basic}</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{ta.fields.customerId}</dt>
            <dd className="font-medium">{data.customerName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{ta.fields.scheduledAt}</dt>
            <dd className="tabular-nums">
              {new Date(data.scheduledAt).toLocaleString("ja-JP")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{ta.fields.status}</dt>
            <dd>
              <Badge variant="outline">{ta.statuses[data.status]}</Badge>
            </dd>
          </div>
        </dl>
      </div>

      {/* マエカク履歴 */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t.listTitle}</h2>

        {data.preCall ? (
          <div className="border-border divide-border divide-y rounded-md border">
            <div className="px-4 py-3">
              <div className="flex items-center justify-between">
                <Badge variant="secondary">{t.resultBadges[data.preCall.result]}</Badge>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {new Date(data.preCall.calledAt).toLocaleString("ja-JP")}
                </span>
              </div>
              {data.preCall.note ? (
                <p className="mt-2 text-sm whitespace-pre-line">{data.preCall.note}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t.noPreCall}</p>
        )}
      </section>

      {/* マエカク記録フォーム (未記録時のみ表示) */}
      {!data.preCall && (
        <PreCallForm appointmentId={id} action={recordPreCallAction} />
      )}

      {data.preCall && (
        <p className="text-muted-foreground rounded-md border p-4 text-sm">
          {t.alreadyRecorded}
        </p>
      )}
    </div>
  );
}
