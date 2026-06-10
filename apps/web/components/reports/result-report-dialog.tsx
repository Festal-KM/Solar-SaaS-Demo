"use client";

// 成果報告（日報）閲覧ポップアップ — レーン/単発イベント共通。
// Google フォーム「ES_日報」の項目を読み取り専用で表示する。
//
// 使い方:
//   <ResultReportTrigger data={report}>成果</ResultReportTrigger>
//   （children を省略すると既定の「成果を見る」リンクを表示）
// もしくは制御コンポーネントとして:
//   <ResultReportDialog data={report} open={open} onOpenChange={setOpen} />

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { labels } from "@/lib/i18n/labels";

import { CustomerReportDialog } from "./customer-report-dialog";
import { buildDemoCustomerReport } from "./customer-report-data";
import type {
  AcquiredCustomer,
  EventBasicReport,
  EventReportsBundle,
  ResultReportData,
} from "./result-report-data";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

// YYYY-MM-DD → YYYY/MM/DD（曜）。
function formatEventDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts as [number, number, number];
  const dow = new Date(y, m - 1, d).getDay();
  return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}（${DOW[dow]}）`;
}

// 基本情報のメタ項目（小ラベル + 値）。値は折り返し可（truncate しない）。
function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-mute-light">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

// KPI スタットタイル（成果の主役）。大きな数値で抽選→着座→アポの funnel を示す。
function StatTile({
  label,
  total,
  both,
  single,
}: {
  label: string;
  total: number;
  both: number;
  single: number;
}) {
  const m = labels.resultReport.metrics;
  return (
    <div className="rounded-lg border border-hairline-light bg-surface-soft/40 px-4 py-3">
      <p className="text-xs font-medium text-mute-light">{label}</p>
      <p className="mt-1 text-[28px] font-bold leading-none tabular-nums text-ink">
        {total.toLocaleString("ja-JP")}
      </p>
      <p className="mt-2 text-[11px] tabular-nums text-mute-light">
        {m.both}
        <span className="ml-1 font-medium text-body-light">{both}</span>
        <span className="mx-1.5 text-cloud-gray">/</span>
        {m.single}
        <span className="ml-1 font-medium text-body-light">{single}</span>
      </p>
    </div>
  );
}

// 成果報告の本体（ダイアログ枠なし）。日付ポップアップ等にインライン埋め込み可能。
export function ResultReportView({ data }: { data: ResultReportData }) {
  const r = labels.resultReport;
  const category = r.categoryLabels[data.category === "housing" ? "housing" : "realestate"];
  const channel =
    data.salesChannel === "cainzW"
      ? r.channelLabels.cainzW
      : data.salesChannel === "cainzV"
        ? r.channelLabels.cainzV
        : r.channelLabels.shimachu;

  return (
    <div className="space-y-5">
      {/* 成果 KPI（主役）— 抽選 → 着座 → アポ の funnel を大きな数値で */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label={r.metrics.lottery}
          total={data.lotteryTotal}
          both={data.lotteryBoth}
          single={data.lotterySingle}
        />
        <StatTile
          label={r.metrics.seated}
          total={data.seatedTotal}
          both={data.seatedBoth}
          single={data.seatedSingle}
        />
        <StatTile
          label={r.metrics.appointment}
          total={data.apptTotal}
          both={data.apptBoth}
          single={data.apptSingle}
        />
      </div>

      {/* 基本情報 — コンパクトなメタ情報グリッド（数値の補足コンテキスト） */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-hairline-light p-4 sm:grid-cols-3">
        <MetaItem label={r.fields.eventDate} value={formatEventDate(data.eventDate)} />
        <MetaItem label={r.fields.venuePlace} value={data.venuePlace} />
        <MetaItem label={r.fields.franchiseNo} value={data.franchiseNo} />
        <MetaItem label={r.fields.category} value={category} />
        <MetaItem label={r.fields.areaInFacility} value={data.areaInFacility} />
        <MetaItem label={r.fields.workingHours} value={`${data.startTime} 〜 ${data.endTime}`} />
        <MetaItem
          label={r.fields.salesChannel}
          value={<Badge variant="secondary">{channel}</Badge>}
        />
      </dl>

      {/* 所感 */}
      <div>
        <h3 className="mb-1.5 text-xs font-medium text-mute-light">{r.sections.impression}</h3>
        <p className="whitespace-pre-wrap rounded-md bg-surface-soft/50 p-3 text-sm leading-relaxed text-body-light">
          {data.impression && data.impression.length > 0 ? data.impression : r.emptyImpression}
        </p>
      </div>
    </div>
  );
}

// 開始 / 終了報告の小カード（提出者・時刻・コメント）。
function ReportNote({ label, report }: { label: string; report: EventBasicReport }) {
  return (
    <div className="rounded-md border border-hairline-light p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <Badge variant="success">{labels.resultReport.submitted}</Badge>
      </div>
      <p className="mt-1 text-xs tabular-nums text-mute-light">
        {report.submitter}・{report.submittedAt}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-body-light">{report.comment}</p>
    </div>
  );
}

// イベント1開催日の報告一式：開始 / 終了 / 成果（日報）をインライン表示する共通ビュー。
// レーン日付ポップアップ・単発イベント詳細で同一の見た目に統一するために使う。
export function EventReportsView({ reports }: { reports: EventReportsBundle }) {
  const r = labels.resultReport;
  return (
    <div className="space-y-5">
      {/* 開始 / 終了報告 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <ReportNote label={r.startReport} report={reports.start} />
        <ReportNote label={r.endReport} report={reports.end} />
      </div>
      {/* 成果報告（日報） */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">{r.title}</h3>
        <ResultReportView data={reports.result} />
      </div>
    </div>
  );
}

// アポ取り顧客一覧 — イベントで獲得したアポ顧客のテーブル。空のときは案内文。
// 行クリックで「初訪アポフォーム」ポップアップを開く。
export function AcquiredAppointmentsTable({ customers }: { customers: AcquiredCustomer[] }) {
  const a = labels.eventList.appointmentColumns;
  const TH = "px-3 py-2 text-left text-xs font-medium text-mute-light";

  const [selected, setSelected] = useState<AcquiredCustomer | null>(null);
  const reportData = useMemo(
    () =>
      selected
        ? buildDemoCustomerReport(`${selected.name}-${selected.dateTime}`, {
            customerName: selected.name,
            area: selected.address,
            firstVisitDisplay: selected.dateTime,
          })
        : null,
    [selected],
  );

  if (customers.length === 0) {
    return <p className="text-sm text-mute-light">{labels.eventList.appointmentPlaceholder}</p>;
  }
  return (
    <>
      <div className="overflow-x-auto rounded-md border border-hairline-light">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline-light bg-surface-soft/50">
              <th className={TH}>{a.customerName}</th>
              <th className={TH}>{a.dateTime}</th>
              <th className={TH}>{a.address}</th>
              <th className={TH}>{a.memo}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-light">
            {customers.map((c, i) => (
              <tr
                key={i}
                tabIndex={0}
                role="button"
                aria-label={`${c.name}${labels.customer.honorific}`}
                className="cursor-pointer transition-colors hover:bg-mist-light active:bg-surface-soft focus:outline-none focus-visible:bg-mist-light focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                onClick={() => setSelected(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(c);
                  }
                }}
              >
                <td className="whitespace-nowrap px-3 py-2.5 font-medium text-ink">
                  {c.name}
                  {labels.customer.honorific}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-body-light">
                  {c.dateTime}
                </td>
                <td className="px-3 py-2.5 text-body-light">{c.address}</td>
                <td className="px-3 py-2.5 text-body-light">{c.memo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CustomerReportDialog
        data={reportData}
        customerName={selected ? `${selected.name}${labels.customer.honorific}` : ""}
        open={selected != null}
        onOpenChange={(next) => !next && setSelected(null)}
      />
    </>
  );
}

interface ResultReportDialogProps {
  data: ResultReportData;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

// 制御コンポーネント版（トリガーは呼び出し側が用意する）。
export function ResultReportDialog({ data, open, onOpenChange }: ResultReportDialogProps) {
  const r = labels.resultReport;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{r.title}</DialogTitle>
        </DialogHeader>
        <ResultReportView data={data} />
      </DialogContent>
    </Dialog>
  );
}

interface ResultReportTriggerProps {
  data: ResultReportData;
  children?: React.ReactNode;
  className?: string;
}

// トリガー内蔵版。children をクリック要素として使う（省略時は「成果を見る」リンク）。
export function ResultReportTrigger({ data, children, className }: ResultReportTriggerProps) {
  const r = labels.resultReport;
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={
            className ??
            "rounded-sm font-medium text-primary underline-offset-2 outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
          }
        >
          {children ?? r.view}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{r.title}</DialogTitle>
        </DialogHeader>
        <ResultReportView data={data} />
      </DialogContent>
    </Dialog>
  );
}
