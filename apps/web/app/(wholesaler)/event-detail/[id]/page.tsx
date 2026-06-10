import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AcquiredAppointmentsTable,
  EventReportsView,
} from "@/components/reports/result-report-dialog";
import {
  buildDemoAppointments,
  buildDemoEventReports,
} from "@/components/reports/result-report-data";
import { labels } from "@/lib/i18n/labels";

import { getEventCandidate, listActiveDealers, listWholesalerUsers } from "../data";
import { AssignSection } from "./assign-section";
import { CandidateStatusSelect } from "./candidate-status-select";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatScheduledDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

export default async function EventCandidateDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [row, wholesalerUsers, dealers] = await Promise.all([
    getEventCandidate(id),
    listWholesalerUsers(),
    listActiveDealers(),
  ]);
  if (!row) notFound();

  const te = labels.event;
  const tl = labels.eventList;

  const venueName = row.venueProviderName ?? row.storeName;
  const hasEvent = row.eventId != null;

  // 報告（開始/終了/成果）+ アポ取り顧客のデモ値を決定論的に生成（同一シード）。
  const reportSeed = row.eventId ?? row.id;
  const reportCtx = { date: row.scheduledDate.slice(0, 10), venuePlace: venueName };
  const demoReports = buildDemoEventReports(reportSeed, reportCtx);
  const demoAppointments = buildDemoAppointments(
    reportSeed,
    demoReports.result.apptTotal,
    reportCtx,
  );

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: tl.title, href: "/events" },
          { label: venueName },
        ]}
      />

      {/* Header */}
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-bold text-ink">{venueName}</h1>
        <p className="text-xs text-mute-light whitespace-nowrap">
          {te.fields.lastUpdated} {new Date(row.updatedAt).toLocaleDateString("ja-JP")}
        </p>
      </div>

      {/* Date + Status bar */}
      <div className="flex items-center justify-between rounded-md border border-hairline-light px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-mute-light whitespace-nowrap">{tl.dateTime}</span>
          <span className="text-sm font-semibold text-ink">{formatScheduledDate(row.scheduledDate)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-mute-light whitespace-nowrap">{tl.holdingStatusLabel}</span>
          <CandidateStatusSelect id={row.id} current={row.status} />
        </div>
      </div>

      {/* Two-column: Basic Info + Assign Info */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Basic Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{te.sections.basicInfo}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div>
                <dt className="text-xs text-link-light">{te.fields.storeName}</dt>
                <dd className="text-sm font-semibold text-ink mt-0.5">{venueName}</dd>
              </div>
              <div>
                <dt className="text-xs text-link-light">{te.fields.address}</dt>
                <dd className="text-sm font-semibold text-ink mt-0.5">
                  {row.venueProviderAddress ?? row.address ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-link-light">{te.fields.contractType}</dt>
                <dd className="text-sm font-semibold text-ink mt-0.5">
                  {row.venueProviderContractType
                    ? (te.contractTypes[row.venueProviderContractType as keyof typeof te.contractTypes] ?? row.venueProviderContractType)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-link-light">{te.fields.fixedFee}</dt>
                <dd className="text-sm font-semibold text-ink mt-0.5">
                  {row.venueProviderFixedFee != null
                    ? `¥${Number(row.venueProviderFixedFee).toLocaleString("ja-JP")}`
                    : "—"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Right: Assign Info */}
        <AssignSection
          candidateId={row.id}
          eventId={row.eventId}
          eventMode={row.eventMode}
          candidateStatus={row.status}
          assignees={row.assignees}
          overallStatus={row.assignees.length > 0 ? "confirmed" : "adjusting"}
          wholesalerUsers={wholesalerUsers}
          dealers={dealers}
          memo={row.eventNote}
        />
      </div>

      {/* Appointment Info table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{tl.appointmentInfo}</CardTitle>
        </CardHeader>
        <CardContent>
          <AcquiredAppointmentsTable customers={demoAppointments} />
        </CardContent>
      </Card>

      {/* Report — 開始/終了/成果 をインライン表示（レーンイベントと同一 UI） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{tl.reportSection}</CardTitle>
        </CardHeader>
        <CardContent>
          <EventReportsView
            reports={buildDemoEventReports(row.eventId ?? row.id, {
              date: row.scheduledDate.slice(0, 10),
              venuePlace: venueName,
            })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
