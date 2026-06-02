"use client";

// 商談履歴タブ上部の「現在の商談状況」入力パネル。
// マエカクステータス / 商談ステータス（= contractStatus）/ 次回アクション をまとめて編集・保存する。

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { updateCustomerAction } from "../actions";

import type { ContractStatusValue } from "../constants";

interface NegotiationStatusPanelProps {
  customerId: string;
  initialMaekaku: "pending" | "done" | "unnecessary" | null;
  initialContractStatus: ContractStatusValue;
  initialNextAction: string | null;
  initialNextAppointmentAt: string | null; // ISO or null
}

const MAEKAKU_UNSET = "__unset__";

// ISO 文字列 → <input type="date"> 用 YYYY-MM-DD（ローカル日付）。
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function NegotiationStatusPanel({
  customerId,
  initialMaekaku,
  initialContractStatus,
  initialNextAction,
  initialNextAppointmentAt,
}: NegotiationStatusPanelProps) {
  const t = labels.customer;
  const d = t.detail;
  const c = labels.common;
  const router = useRouter();

  const [maekaku, setMaekaku] = useState<string>(initialMaekaku ?? MAEKAKU_UNSET);
  const [contractStatus, setContractStatus] = useState<ContractStatusValue>(initialContractStatus);
  const [nextAction, setNextAction] = useState(initialNextAction ?? "");
  const [nextAppointmentAt, setNextAppointmentAt] = useState(toDateInput(initialNextAppointmentAt));
  const [isPending, startTransition] = useTransition();

  const dirty =
    maekaku !== (initialMaekaku ?? MAEKAKU_UNSET) ||
    contractStatus !== initialContractStatus ||
    nextAction !== (initialNextAction ?? "") ||
    nextAppointmentAt !== toDateInput(initialNextAppointmentAt);

  function handleSave() {
    startTransition(async () => {
      try {
        await updateCustomerAction({
          id: customerId,
          maekakuStatus:
            maekaku === MAEKAKU_UNSET ? null : (maekaku as "pending" | "done" | "unnecessary"),
          contractStatus,
          nextAction: nextAction.trim() ? nextAction.trim() : null,
          nextAppointmentAt: nextAppointmentAt || null,
        });
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  const selectClass =
    "h-9 w-full rounded-sm border border-hairline-light bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <div className="space-y-4">
      {/* 上段サブパネル: マエカク / 商談ステータス / 次回アポ日程 を横並び */}
      <div className="border-hairline-light bg-surface-soft/40 rounded-lg border p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="neg-maekaku">{d.negotiation.maekaku}</Label>
          <select
            id="neg-maekaku"
            value={maekaku}
            onChange={(e) => setMaekaku(e.target.value)}
            className={selectClass}
          >
            <option value={MAEKAKU_UNSET}>{d.unassigned}</option>
            <option value="pending">{d.negotiation.maekakuLabels.pending}</option>
            <option value="done">{d.negotiation.maekakuLabels.done}</option>
            <option value="unnecessary">{d.negotiation.maekakuLabels.unnecessary}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="neg-status">{d.negotiation.dealStatus}</Label>
          <select
            id="neg-status"
            value={contractStatus}
            onChange={(e) => setContractStatus(e.target.value as ContractStatusValue)}
            className={selectClass}
          >
            <option value="negotiating">{t.contractStatusLabels.negotiating}</option>
            <option value="contracted">{t.contractStatusLabels.contracted}</option>
            <option value="lost">{t.contractStatusLabels.lost}</option>
            <option value="cancelled">{t.contractStatusLabels.cancelled}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="neg-next-appointment">{d.negotiation.nextAppointment}</Label>
            <input
              id="neg-next-appointment"
              type="date"
              value={nextAppointmentAt}
              onChange={(e) => setNextAppointmentAt(e.target.value)}
              className={selectClass}
            />
          </div>
        </div>
      </div>

      {/* 下段サブパネル: 次回アクション */}
      <div className="border-hairline-light bg-surface-soft/40 rounded-lg border p-4">
        <div className="space-y-1.5">
          <Label htmlFor="neg-next-action">{d.negotiation.nextAction}</Label>
          <textarea
            id="neg-next-action"
            rows={2}
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            placeholder={d.negotiation.nextActionPlaceholder}
            className="w-full resize-none rounded-md border border-hairline-light bg-white px-3 py-2 text-sm text-ink placeholder:text-mute-light focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={handleSave} disabled={isPending || !dirty}>
          {isPending ? c.saving : d.negotiation.save}
        </Button>
      </div>
    </div>
  );
}
