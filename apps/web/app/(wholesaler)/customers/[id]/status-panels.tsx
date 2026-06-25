"use client";

// 顧客詳細の 契約状況 / 施工状況 / 設置申請状況 タブのインライン編集パネル。
// それぞれ updateCustomerAction で保存する。ステータスはプルダウン切替。

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { updateCustomerAction } from "../actions";
import { CONSTRUCTION_STATUS_VALUES, SUBSIDY_STATUS_VALUES } from "../constants";

import type { ConstructionStatusValue, SubsidyStatusValue } from "../constants";

// ISO → <input type="date"> 用 YYYY-MM-DD（ローカル日付）。
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

const FIELD =
  "h-9 w-full rounded-sm border border-hairline-light bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

function SaveRow({ onSave, pending, dirty }: { onSave: () => void; pending: boolean; dirty: boolean }) {
  const c = labels.common;
  return (
    <div className="flex justify-end">
      <Button type="button" size="sm" onClick={onSave} disabled={pending || !dirty}>
        {pending ? c.saving : c.save}
      </Button>
    </div>
  );
}

/* ── 施工状況: ステータス（プルダウン）/ 工事予定日 / 対応事業者 ── */

export function ConstructionStatusPanel({
  customerId,
  initial,
}: {
  customerId: string;
  initial: { status: ConstructionStatusValue; plannedDate: string | null; vendor: string | null };
}) {
  const t = labels.customer;
  const d = t.detail;
  const c = labels.common;
  const router = useRouter();

  const [status, setStatus] = useState<ConstructionStatusValue>(initial.status);
  const [plannedDate, setPlannedDate] = useState(toDateInput(initial.plannedDate));
  const [vendor, setVendor] = useState(initial.vendor ?? "");
  const [pending, start] = useTransition();

  const dirty =
    status !== initial.status ||
    plannedDate !== toDateInput(initial.plannedDate) ||
    vendor !== (initial.vendor ?? "");

  function onSave() {
    start(async () => {
      try {
        await updateCustomerAction({
          id: customerId,
          constructionStatus: status,
          constructionPlannedDate: plannedDate || null,
          constructionVendor: vendor.trim() || null,
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="construction-status">{d.statusLabel}</Label>
          <select
            id="construction-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ConstructionStatusValue)}
            className={FIELD}
          >
            {CONSTRUCTION_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {t.constructionStatusLabels[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="construction-date">{d.constructionFields.plannedDate}</Label>
          <input
            id="construction-date"
            type="date"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
            className={FIELD}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="construction-vendor">{d.constructionFields.vendor}</Label>
          <Input
            id="construction-vendor"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder={d.constructionFields.vendorPlaceholder}
          />
        </div>
      </div>
      <SaveRow onSave={onSave} pending={pending} dirty={dirty} />
    </div>
  );
}

/* ── 設置申請状況: ステータス（プルダウン）/ 申請種別 / 申請日 / 承認日 ── */

export function SubsidyStatusPanel({
  customerId,
  initial,
}: {
  customerId: string;
  initial: {
    status: SubsidyStatusValue;
    type: string | null;
    submittedDate: string | null;
    grantedDate: string | null;
  };
}) {
  const t = labels.customer;
  const d = t.detail;
  const c = labels.common;
  const router = useRouter();

  const [status, setStatus] = useState<SubsidyStatusValue>(initial.status);
  const [type, setType] = useState(initial.type ?? "");
  const [submittedDate, setSubmittedDate] = useState(toDateInput(initial.submittedDate));
  const [grantedDate, setGrantedDate] = useState(toDateInput(initial.grantedDate));
  const [pending, start] = useTransition();

  const dirty =
    status !== initial.status ||
    type !== (initial.type ?? "") ||
    submittedDate !== toDateInput(initial.submittedDate) ||
    grantedDate !== toDateInput(initial.grantedDate);

  function onSave() {
    start(async () => {
      try {
        await updateCustomerAction({
          id: customerId,
          subsidyStatus: status,
          subsidyType: type.trim() || null,
          subsidySubmittedDate: submittedDate || null,
          subsidyGrantedDate: grantedDate || null,
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="subsidy-status">{d.statusLabel}</Label>
          <select
            id="subsidy-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as SubsidyStatusValue)}
            className={FIELD}
          >
            {SUBSIDY_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {t.subsidyStatusLabels[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="subsidy-type">{d.subsidyFields.type}</Label>
          <Input id="subsidy-type" value={type} onChange={(e) => setType(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="subsidy-submitted">{d.subsidyFields.submittedDate}</Label>
          <input
            id="subsidy-submitted"
            type="date"
            value={submittedDate}
            onChange={(e) => setSubmittedDate(e.target.value)}
            className={FIELD}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="subsidy-granted">{d.subsidyFields.grantedDate}</Label>
          <input
            id="subsidy-granted"
            type="date"
            value={grantedDate}
            onChange={(e) => setGrantedDate(e.target.value)}
            className={FIELD}
          />
        </div>
      </div>
      <SaveRow onSave={onSave} pending={pending} dirty={dirty} />
    </div>
  );
}
