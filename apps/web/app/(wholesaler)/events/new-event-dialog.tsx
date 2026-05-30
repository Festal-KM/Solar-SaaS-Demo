"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { createEventCandidateAction } from "../event-detail/actions";

import type { ActiveVenueProviderOption, AreaOption, StoreOption } from "../event-detail/data";
import type { EventCandidateInput } from "@solar/contracts";

interface NewEventDialogProps {
  venueProviders: ActiveVenueProviderOption[];
  areas: AreaOption[];
  stores: StoreOption[];
}

// フォーム上のステータス選択肢 → 送信ステータスのマッピング。
// 確認中 → DRAFT / 確定 → DECIDED / 中止 → CANCELLED。
// OPEN/CLOSED は publish/close フローを経るべきなので作成時は選べない。
type StatusChoice = "pending" | "confirmed" | "cancelled";
const STATUS_TO_PAYLOAD: Record<StatusChoice, "DRAFT" | "DECIDED" | "CANCELLED"> = {
  pending: "DRAFT",
  confirmed: "DECIDED",
  cancelled: "CANCELLED",
};

interface FormState {
  venueProviderId: string;
  scheduledDate: string;
  storeName: string;
  area: string;
  address: string;
  status: StatusChoice;
  contractType: "" | "FIXED" | "PERFORMANCE" | "OTHER";
  fixedFee: string;
  performanceRate: string;
  contractNote: string;
}

const EMPTY: FormState = {
  venueProviderId: "",
  scheduledDate: "",
  storeName: "",
  area: "",
  address: "",
  status: "pending",
  contractType: "",
  fixedFee: "",
  performanceRate: "",
  contractNote: "",
};

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-hairline-light bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

export function NewEventDialog({ venueProviders, areas, stores }: NewEventDialogProps) {
  const router = useRouter();
  const t = labels.eventCandidate;
  const c = labels.common;
  const tl = labels.eventList;

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!values.scheduledDate) {
      setError(t.errors.scheduledDateRequired);
      return;
    }
    if (!values.storeName.trim()) {
      setError(t.errors.storeNameRequired);
      return;
    }

    const blank = (s: string) => (s.trim().length === 0 ? undefined : s.trim());

    startTransition(async () => {
      try {
        // 対象年月は実施予定日 (YYYY-MM-DD) の先頭 7 文字から自動算出し、
        // 回答期限は実施予定日と同値にする（いずれもフォームからは入力しない）。
        const payload: EventCandidateInput = {
          venueProviderId: blank(values.venueProviderId),
          targetMonth: values.scheduledDate.slice(0, 7),
          scheduledDate: new Date(values.scheduledDate),
          storeName: values.storeName.trim(),
          address: blank(values.address),
          area: blank(values.area),
          deadlineAt: new Date(values.scheduledDate),
          contractType: values.contractType === "" ? undefined : values.contractType,
          fixedFee: values.contractType === "FIXED" ? blank(values.fixedFee) : undefined,
          performanceRate:
            values.contractType === "PERFORMANCE" ? blank(values.performanceRate) : undefined,
          contractNote: blank(values.contractNote),
          status: STATUS_TO_PAYLOAD[values.status],
        };
        const result = await createEventCandidateAction(payload);
        toast.success(c.saved);
        setOpen(false);
        setValues(EMPTY);
        router.push(`/event-detail/${result.id}`);
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{tl.newEvent}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.new}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-2" noValidate>
          {/* 場所提供元 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-mute-light" htmlFor="ne-venue">
              {t.fields.venueProvider}
            </label>
            <select
              id="ne-venue"
              value={values.venueProviderId}
              onChange={(e) => update("venueProviderId", e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">{c.notSet}</option>
              {venueProviders.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.area ? `（${v.area}）` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* 店舗名 / エリア */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-mute-light" htmlFor="ne-store">
                {t.fields.storeName} <span className="text-warning">*</span>
              </label>
              <select
                id="ne-store"
                value={values.storeName}
                onChange={(e) => update("storeName", e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">{c.notSet}</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-mute-light" htmlFor="ne-area">
                {t.fields.area}
              </label>
              <select
                id="ne-area"
                value={values.area}
                onChange={(e) => update("area", e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">{c.notSet}</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 住所 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-mute-light" htmlFor="ne-address">
              {t.fields.address}
            </label>
            <Input id="ne-address" value={values.address} onChange={(e) => update("address", e.target.value)} />
          </div>

          {/* 実施日 / ステータス */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-mute-light" htmlFor="ne-date">
                {t.fields.scheduledDate} <span className="text-warning">*</span>
              </label>
              <Input id="ne-date" type="date" value={values.scheduledDate} onChange={(e) => update("scheduledDate", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-mute-light" htmlFor="ne-status">
                {t.fields.status}
              </label>
              <select
                id="ne-status"
                value={values.status}
                onChange={(e) => update("status", e.target.value as StatusChoice)}
                className={SELECT_CLASS}
              >
                <option value="pending">{tl.holdingStatuses.pending}</option>
                <option value="confirmed">{tl.holdingStatuses.confirmed}</option>
                <option value="cancelled">{tl.holdingStatuses.cancelled}</option>
              </select>
            </div>
          </div>

          {/* 契約条件（内部） */}
          <div className="rounded-md border border-dashed border-hairline-light bg-surface-soft/40 p-4 space-y-3">
            <p className="text-xs font-medium text-ink">{t.sections.contract}</p>
            <div className="space-y-1.5">
              <label className="text-xs text-mute-light" htmlFor="ne-ct">{t.fields.contractType}</label>
              <select
                id="ne-ct"
                value={values.contractType}
                onChange={(e) => update("contractType", e.target.value as FormState["contractType"])}
                className={SELECT_CLASS}
              >
                <option value="">{c.notSet}</option>
                <option value="FIXED">{labels.venueProvider.contractTypes.FIXED}</option>
                <option value="PERFORMANCE">{labels.venueProvider.contractTypes.PERFORMANCE}</option>
                <option value="OTHER">{labels.venueProvider.contractTypes.OTHER}</option>
              </select>
            </div>

            {values.contractType === "FIXED" ? (
              <div className="space-y-1.5">
                <label className="text-xs text-mute-light" htmlFor="ne-fee">{t.fields.perDayFee}</label>
                <Input id="ne-fee" inputMode="decimal" value={values.fixedFee} onChange={(e) => update("fixedFee", e.target.value)} />
              </div>
            ) : null}

            {values.contractType === "PERFORMANCE" ? (
              <div className="space-y-1.5">
                <label className="text-xs text-mute-light" htmlFor="ne-rate">{t.fields.revenueRate}</label>
                <Input id="ne-rate" inputMode="decimal" value={values.performanceRate} onChange={(e) => update("performanceRate", e.target.value)} />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="text-xs text-mute-light" htmlFor="ne-cnote">{t.fields.contractNote}</label>
              <textarea
                id="ne-cnote"
                rows={2}
                value={values.contractNote}
                onChange={(e) => update("contractNote", e.target.value)}
                className="w-full rounded-md border border-hairline-light bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
          </div>

          {error && <p role="alert" className="text-sm font-medium text-warning">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{c.cancel}</Button>
            <Button type="submit" disabled={pending}>{pending ? c.saving : t.actions.createSubmit}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
