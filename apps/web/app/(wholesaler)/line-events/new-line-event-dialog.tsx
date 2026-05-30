"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
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

import { createLineEventAction } from "./actions";

import type {
  ActiveVenueProviderOption,
  AreaOption,
  DealerOption,
  StoreOption,
  WholesalerUserOption,
} from "./data";
import type { LineEventInput } from "@solar/contracts";

interface NewLineEventDialogProps {
  venueProviders: ActiveVenueProviderOption[];
  areas: AreaOption[];
  stores: StoreOption[];
  wholesalerUsers: WholesalerUserOption[];
  dealers: DealerOption[];
  defaultMonth: string;
}

// フォーム上のステータス選択肢 → 送信ステータスのマッピング。
// 確認中 → DRAFT / 確定 → CONFIRMED / 中止 → CANCELLED。
type StatusChoice = "pending" | "confirmed" | "cancelled";
const STATUS_TO_PAYLOAD: Record<StatusChoice, "DRAFT" | "CONFIRMED" | "CANCELLED"> = {
  pending: "DRAFT",
  confirmed: "CONFIRMED",
  cancelled: "CANCELLED",
};

type AssignMode = "SELF" | "DEALER" | "JOINT";
type AssignStatusChoice = "confirmed" | "adjusting";

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-hairline-light bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

// 月曜始まりの曜日ヘッダー。
const MON_WEEK_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

// 月曜始まりでの列インデックス（月=0 … 日=6）に変換する。
function mondayColumn(dow: number): number {
  return (dow + 6) % 7;
}

// Timezone-safe local-date helpers (CLAUDE.md 注意事項 / toISOString は使わない)。
function daysInMonth(targetMonth: string): number {
  const [y, m] = targetMonth.split("-").map(Number);
  if (!y || !m) return 0;
  return new Date(y, m, 0).getDate();
}

function dayStr(targetMonth: string, day: number): string {
  return `${targetMonth}-${String(day).padStart(2, "0")}`;
}

function dayOfWeek(targetMonth: string, day: number): number {
  const [y, m] = targetMonth.split("-").map(Number);
  return new Date(y!, m! - 1, day).getDay();
}

interface FormState {
  name: string;
  venueProviderId: string;
  area: string;
  address: string;
  targetMonth: string;
  status: StatusChoice;
  contractType: "" | "FIXED" | "PERFORMANCE" | "OTHER";
  fixedFee: string;
  performanceRate: string;
  contractNote: string;
  assignMode: "" | AssignMode;
  assignStatus: AssignStatusChoice;
  assignNote: string;
}

function emptyForm(defaultMonth: string): FormState {
  return {
    name: "",
    venueProviderId: "",
    area: "",
    address: "",
    targetMonth: defaultMonth,
    status: "pending",
    contractType: "",
    fixedFee: "",
    performanceRate: "",
    contractNote: "",
    assignMode: "",
    assignStatus: "adjusting",
    assignNote: "",
  };
}

function ModeButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex-1 rounded-md px-4 py-3 text-sm font-medium transition-colors border",
        selected
          ? "border-primary bg-primary text-white"
          : "border-hairline-light bg-white text-ink hover:border-primary/40 hover:bg-primary/5",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export function NewLineEventDialog({
  venueProviders,
  areas,
  stores,
  wholesalerUsers,
  dealers,
  defaultMonth,
}: NewLineEventDialogProps) {
  const router = useRouter();
  const t = labels.lineEvent;
  const tl = labels.eventList;
  const c = labels.common;

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<FormState>(() => emptyForm(defaultMonth));
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [selectedStaff, setSelectedStaff] = useState<string[]>([]);
  const [selectedDealers, setSelectedDealers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const days = useMemo(() => {
    const total = daysInMonth(values.targetMonth);
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [values.targetMonth]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  // 対象月を変えたら、その月に属さない選択日をクリアする。
  function changeMonth(month: string) {
    setValues((prev) => ({ ...prev, targetMonth: month }));
    setSelectedDates((prev) => {
      const next = new Set<string>();
      for (const d of prev) {
        if (d.startsWith(`${month}-`)) next.add(d);
      }
      return next;
    });
  }

  function toggleDate(date: string) {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  const toggleStaff = useCallback((userId: string) => {
    setSelectedStaff((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }, []);

  const toggleDealer = useCallback((relId: string) => {
    setSelectedDealers((prev) =>
      prev.includes(relId) ? prev.filter((id) => id !== relId) : [...prev, relId],
    );
  }, []);

  function resetForm() {
    setValues(emptyForm(defaultMonth));
    setSelectedDates(new Set());
    setSelectedStaff([]);
    setSelectedDealers([]);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!values.name.trim()) {
      setError(t.errors.venueNameRequired);
      return;
    }
    if (!values.targetMonth) {
      setError(t.errors.targetMonthRequired);
      return;
    }
    if (selectedDates.size === 0) {
      setError(t.errors.scheduledDatesRequired);
      return;
    }

    const blank = (s: string) => (s.trim().length === 0 ? undefined : s.trim());
    const mode = values.assignMode === "" ? undefined : values.assignMode;
    const staffIds = mode === "SELF" || mode === "JOINT" ? selectedStaff : [];
    const dealerIds = mode === "DEALER" || mode === "JOINT" ? selectedDealers : [];

    startTransition(async () => {
      try {
        const payload: LineEventInput = {
          name: values.name.trim(),
          venueProviderId: blank(values.venueProviderId),
          area: blank(values.area),
          address: blank(values.address),
          targetMonth: values.targetMonth,
          scheduledDates: Array.from(selectedDates).sort(),
          contractType: values.contractType === "" ? undefined : values.contractType,
          fixedFee: values.contractType === "FIXED" ? blank(values.fixedFee) : undefined,
          performanceRate:
            values.contractType === "PERFORMANCE" ? blank(values.performanceRate) : undefined,
          contractNote: blank(values.contractNote),
          status: STATUS_TO_PAYLOAD[values.status],
          assignMode: mode,
          assignStatus: values.assignStatus === "confirmed" ? "CONFIRMED" : "ADJUSTING",
          assignStaffIds: staffIds,
          assignDealerIds: dealerIds,
          assignNote: blank(values.assignNote),
        };
        const result = await createLineEventAction(payload);
        toast.success(c.saved);
        setOpen(false);
        resetForm();
        router.push(`/line-events/${result.id}`);
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button>{t.newLine}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.newLine}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-2" noValidate>
          {/* 1行目: 場所提供元 / 場所名 / エリア */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-mute-light" htmlFor="nl-venue">
                {t.fields.venueProvider}
              </label>
              <select
                id="nl-venue"
                value={values.venueProviderId}
                onChange={(e) => update("venueProviderId", e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">{c.notSet}</option>
                {venueProviders.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.area ? `（${v.area}）` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-mute-light" htmlFor="nl-name">
                {t.fields.venueName} <span className="text-warning">*</span>
              </label>
              <select
                id="nl-name"
                value={values.name}
                onChange={(e) => update("name", e.target.value)}
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
              <label className="text-xs font-medium text-mute-light" htmlFor="nl-area">
                {t.fields.area}
              </label>
              <select
                id="nl-area"
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

          {/* 2行目: 住所（横幅いっぱい） */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-mute-light" htmlFor="nl-address">
              {t.fields.address}
            </label>
            <Input
              id="nl-address"
              value={values.address}
              onChange={(e) => update("address", e.target.value)}
            />
          </div>

          {/* 対象月 / ステータス */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-mute-light" htmlFor="nl-month">
                {t.fields.targetMonth} <span className="text-warning">*</span>
              </label>
              <Input
                id="nl-month"
                type="month"
                value={values.targetMonth}
                onChange={(e) => changeMonth(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-mute-light" htmlFor="nl-status">
                {t.fields.status}
              </label>
              <select
                id="nl-status"
                value={values.status}
                onChange={(e) => update("status", e.target.value as StatusChoice)}
                className={SELECT_CLASS}
              >
                <option value="pending">{t.statuses.DRAFT}</option>
                <option value="confirmed">{t.statuses.CONFIRMED}</option>
                <option value="cancelled">{t.statuses.CANCELLED}</option>
              </select>
            </div>
          </div>

          {/* 開催日（カレンダーチェックボックスグリッド） */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-mute-light">
                {t.fields.scheduledDates} <span className="text-warning">*</span>
              </label>
              <span className="text-xs text-mute-light tabular-nums">
                {t.form.selectedCount.replace("{n}", String(selectedDates.size))}
              </span>
            </div>
            {values.targetMonth ? (
              <div className="rounded-md border border-hairline-light p-3">
                {/* 曜日ヘッダー（月曜始まり） */}
                <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                  {MON_WEEK_LABELS.map((w, i) => (
                    <div
                      key={w}
                      className={[
                        "text-center text-[10px] font-medium",
                        i === 5 ? "text-link-light" : i === 6 ? "text-warning" : "text-mute-light",
                      ].join(" ")}
                    >
                      {w}
                    </div>
                  ))}
                </div>
                {/* 日付グリッド */}
                <div className="grid grid-cols-7 gap-1.5">
                  {/* 1日の前に月曜始まりの空白マスを置く */}
                  {Array.from({ length: mondayColumn(dayOfWeek(values.targetMonth, 1)) }).map(
                    (_, i) => (
                      <div key={`blank-${i}`} aria-hidden />
                    ),
                  )}
                  {days.map((day) => {
                    const ds = dayStr(values.targetMonth, day);
                    const dow = dayOfWeek(values.targetMonth, day);
                    const checked = selectedDates.has(ds);
                    const numColor =
                      dow === 0 ? "text-warning" : dow === 6 ? "text-link-light" : "";
                    return (
                      <button
                        key={ds}
                        type="button"
                        onClick={() => toggleDate(ds)}
                        className={[
                          "flex items-center justify-center rounded-md border py-2 text-sm transition-colors tabular-nums",
                          checked
                            ? "border-primary bg-primary text-white font-semibold"
                            : `border-hairline-light hover:bg-surface-soft/50 ${numColor || "text-body-light"}`,
                        ].join(" ")}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-mute-light">{t.form.selectDates}</p>
            )}
          </div>

          {/* 契約条件 */}
          <div className="rounded-md border border-dashed border-hairline-light bg-surface-soft/40 p-4 space-y-3">
            <p className="text-xs font-medium text-ink">{t.sections.contract}</p>
            <div className="space-y-1.5">
              <label className="text-xs text-mute-light" htmlFor="nl-ct">
                {t.fields.contractType}
              </label>
              <select
                id="nl-ct"
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
                <label className="text-xs text-mute-light" htmlFor="nl-fee">
                  {t.fields.perDayFee}
                </label>
                <Input
                  id="nl-fee"
                  inputMode="decimal"
                  value={values.fixedFee}
                  onChange={(e) => update("fixedFee", e.target.value)}
                />
              </div>
            ) : null}

            {values.contractType === "PERFORMANCE" ? (
              <div className="space-y-1.5">
                <label className="text-xs text-mute-light" htmlFor="nl-rate">
                  {t.fields.revenueRate}
                </label>
                <Input
                  id="nl-rate"
                  inputMode="decimal"
                  value={values.performanceRate}
                  onChange={(e) => update("performanceRate", e.target.value)}
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="text-xs text-mute-light" htmlFor="nl-cnote">
                {t.fields.contractNote}
              </label>
              <textarea
                id="nl-cnote"
                rows={2}
                value={values.contractNote}
                onChange={(e) => update("contractNote", e.target.value)}
                className="w-full rounded-md border border-hairline-light bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
          </div>

          {/* アサイン情報 */}
          <div className="rounded-md border border-dashed border-hairline-light bg-surface-soft/40 p-4 space-y-4">
            <p className="text-xs font-medium text-ink">{t.sections.assign}</p>

            <div>
              <p className="text-xs font-medium text-mute-light mb-2">{tl.assignModeLabel}</p>
              <div className="flex gap-2">
                <ModeButton
                  label={tl.assignModeSelf}
                  selected={values.assignMode === "SELF"}
                  onClick={() => update("assignMode", "SELF")}
                />
                <ModeButton
                  label={tl.assignModeDealer}
                  selected={values.assignMode === "DEALER"}
                  onClick={() => update("assignMode", "DEALER")}
                />
                <ModeButton
                  label={tl.assignModeJoint}
                  selected={values.assignMode === "JOINT"}
                  onClick={() => update("assignMode", "JOINT")}
                />
              </div>
            </div>

            {(values.assignMode === "SELF" || values.assignMode === "JOINT") && (
              <div>
                <p className="text-xs font-medium text-mute-light mb-2">{tl.assignSelectStaff}</p>
                <div className="border border-hairline-light rounded-md max-h-48 overflow-y-auto bg-white">
                  {wholesalerUsers.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-soft/50 cursor-pointer border-b border-hairline-light last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selectedStaff.includes(u.id)}
                        onChange={() => toggleStaff(u.id)}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                      />
                      <span className="text-sm text-ink">{u.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {(values.assignMode === "DEALER" || values.assignMode === "JOINT") && (
              <div>
                <p className="text-xs font-medium text-mute-light mb-2">{tl.assignDealerName}</p>
                <div className="border border-hairline-light rounded-md max-h-48 overflow-y-auto bg-white">
                  {dealers.map((d) => (
                    <label
                      key={d.relationshipId}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-soft/50 cursor-pointer border-b border-hairline-light last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDealers.includes(d.relationshipId)}
                        onChange={() => toggleDealer(d.relationshipId)}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                      />
                      <span className="text-sm text-ink">{d.dealerName}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-mute-light" htmlFor="nl-assign-status">
                {tl.assignOverallStatus}
              </label>
              <select
                id="nl-assign-status"
                value={values.assignStatus}
                onChange={(e) => update("assignStatus", e.target.value as AssignStatusChoice)}
                className={SELECT_CLASS}
              >
                <option value="adjusting">{tl.assignStatusOptions.adjusting}</option>
                <option value="confirmed">{tl.assignStatusOptions.confirmed}</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-mute-light" htmlFor="nl-assign-note">
                {tl.assignMemo}
              </label>
              <textarea
                id="nl-assign-note"
                rows={2}
                value={values.assignNote}
                onChange={(e) => update("assignNote", e.target.value)}
                placeholder={tl.assignMemoPlaceholder}
                className="w-full rounded-md border border-hairline-light bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-warning">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {c.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? c.saving : t.actions.createSubmit}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
