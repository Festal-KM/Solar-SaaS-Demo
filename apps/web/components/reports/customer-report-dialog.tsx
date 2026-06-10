"use client";

// イベント獲得顧客の「初訪アポフォーム」閲覧ポップアップ（読み取り専用）。
// 顧客一覧の行クリックで開く。情報をセクションごとのメタグリッドで表示する。

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { labels } from "@/lib/i18n/labels";

import type { CustomerReportData } from "./customer-report-data";

function MetaItem({ label, value }: { label: string; value: string | null }) {
  const empty = labels.customerReport.empty;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-mute-light">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{value && value.length > 0 ? value : empty}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute-light">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-hairline-light p-4 sm:grid-cols-3">
        {children}
      </dl>
    </section>
  );
}

interface CustomerReportDialogProps {
  data: CustomerReportData | null;
  customerName: string;
  detailHref?: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function CustomerReportDialog({
  data,
  customerName,
  detailHref,
  open,
  onOpenChange,
}: CustomerReportDialogProps) {
  const r = labels.customerReport;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-x-2">
            <span>{r.title}</span>
            {customerName ? (
              <span className="text-sm font-normal text-mute-light">{customerName}</span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {data ? (
          <div className="space-y-5">
            <Section title={r.sections.org}>
              <MetaItem label={r.fields.franchiseNo} value={data.franchiseNo} />
              <MetaItem label={r.fields.closeCompany} value={data.closeCompany} />
              <MetaItem label={r.fields.channel} value={data.channel} />
              <MetaItem label={r.fields.tossGetter} value={data.tossGetter} />
              <MetaItem label={r.fields.salesRep} value={data.salesRep} />
            </Section>

            <Section title={r.sections.event}>
              <MetaItem label={r.fields.eventDate} value={data.eventDate.replace(/-/g, "/")} />
              <MetaItem label={r.fields.venuePlace} value={data.venuePlace} />
              <MetaItem label={r.fields.eventType} value={data.eventType} />
              <MetaItem label={r.fields.faceToFace} value={data.faceToFace} />
            </Section>

            <Section title={r.sections.customer}>
              <MetaItem label={r.fields.customerName} value={data.customerName} />
              <MetaItem label={r.fields.kana} value={data.kana} />
              <MetaItem label={r.fields.mobile} value={data.mobile} />
              <MetaItem label={r.fields.landline} value={data.landline} />
              <MetaItem label={r.fields.postalCode} value={data.postalCode} />
              <MetaItem label={r.fields.prefecture} value={data.prefecture} />
              <MetaItem label={r.fields.cityAddress} value={data.cityAddress} />
            </Section>

            <Section title={r.sections.appointment}>
              <MetaItem label={r.fields.firstVisitAt} value={data.firstVisitAt} />
              <MetaItem label={r.fields.maekakuPreferredAt} value={data.maekakuPreferredAt} />
              <MetaItem label={r.fields.maekakuOperator} value={data.maekakuOperator} />
            </Section>

            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-mute-light">
                {r.sections.note}
              </h3>
              <p className="whitespace-pre-wrap rounded-md bg-surface-soft/60 p-3 text-sm leading-relaxed text-body-light">
                {data.note && data.note.length > 0 ? data.note : r.empty}
              </p>
            </div>

            {/* アクション — 顧客詳細への二次導線（フッター右寄せ） */}
            {detailHref ? (
              <div className="flex justify-end border-t border-hairline-light pt-4">
                <Button asChild variant="outline" size="sm">
                  <Link href={detailHref}>
                    {r.openDetail}
                    <ArrowUpRight />
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
