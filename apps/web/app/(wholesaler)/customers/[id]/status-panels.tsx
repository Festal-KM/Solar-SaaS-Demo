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

import type {
  ContractStatusValue,
  ConstructionStatusValue,
  SubsidyStatusValue,
} from "../constants";

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

/* ── 契約状況: 契約プラン / 金額 / 契約予定日（商談ステータスは表示しない） ── */

export function ContractStatusPanel({
  customerId,
  initial,
}: {
  customerId: string;
  initial: { plan: string | null; amount: number | null; expectedDate: string | null };
}) {
  const d = labels.customer.detail;
  const c = labels.common;
  const router = useRouter();

  const [plan, setPlan] = useState(initial.plan ?? "");
  const [amount, setAmount] = useState(initial.amount != null ? String(initial.amount) : "");
  const [expectedDate, setExpectedDate] = useState(toDateInput(initial.expectedDate));
  const [pending, start] = useTransition();

  const dirty =
    plan !== (initial.plan ?? "") ||
    amount !== (initial.amount != null ? String(initial.amount) : "") ||
    expectedDate !== toDateInput(initial.expectedDate);

  function onSave() {
    const amountNum = Math.floor(Number(amount));
    start(async () => {
      try {
        await updateCustomerAction({
          id: customerId,
          contractPlan: plan.trim() || null,
          contractAmount: amount.trim() && Number.isFinite(amountNum) && amountNum >= 0 ? amountNum : null,
          contractExpectedDate: expectedDate || null,
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
          <Label htmlFor="contract-plan">{d.contractFields.plan}</Label>
          <Input id="contract-plan" value={plan} onChange={(e) => setPlan(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contract-amount">{d.contractFields.amount}</Label>
          <Input
            id="contract-amount"
            type="number"
            inputMode="numeric"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contract-date">{d.contractFields.expectedDate}</Label>
          <input
            id="contract-date"
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            className={FIELD}
          />
        </div>
      </div>
      <SaveRow onSave={onSave} pending={pending} dirty={dirty} />
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
            <option value="not_started">{t.constructionStatusLabels.not_started}</option>
            <option value="in_progress">{t.constructionStatusLabels.in_progress}</option>
            <option value="done">{t.constructionStatusLabels.done}</option>
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
            <option value="none">{t.subsidyStatusLabels.none}</option>
            <option value="applying">{t.subsidyStatusLabels.applying}</option>
            <option value="granted">{t.subsidyStatusLabels.granted}</option>
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
