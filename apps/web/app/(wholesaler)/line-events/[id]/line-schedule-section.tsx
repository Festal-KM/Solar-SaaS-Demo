"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AcquiredAppointmentsTable,
  EventReportsView,
} from "@/components/reports/result-report-dialog";
import {
  buildDemoAppointments,
  buildDemoEventReports,
} from "@/components/reports/result-report-data";
import { labels } from "@/lib/i18n/labels";

import { updateLineDatesAction } from "./actions";

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 月曜始まりの曜日ヘッダー（登録ダイアログと統一）。
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

function dowColor(dow: number): string {
  return dow === 0 ? "text-warning" : dow === 6 ? "text-link-light" : "text-mute-light";
}

// 開催予定日チップ用ラベル（6/03(水) 形式）。曜日色付けのため dow も返す。
function chipLabel(targetMonth: string, day: number): { text: string; dow: number } {
  const [, m] = targetMonth.split("-").map(Number);
  const dow = dayOfWeek(targetMonth, day);
  return { text: `${m}/${String(day).padStart(2, "0")}(${DAY_LABELS[dow]})`, dow };
}

interface LineScheduleSectionProps {
  lineEventId: string;
  targetMonth: string;
  scheduledDates: string[];
  contractNote: string | null;
  // 催事場所（レーンイベント名 = 開催場所名）。成果報告ポップアップに渡す。
  venuePlace: string;
}

export function LineScheduleSection({
  lineEventId,
  targetMonth,
  scheduledDates,
  contractNote,
  venuePlace,
}: LineScheduleSectionProps) {
  const router = useRouter();
  const t = labels.lineEvent;
  const tl = labels.eventList;
  const c = labels.common;

  const [editOpen, setEditOpen] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set(scheduledDates));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 日付ポップアップ — null のとき非表示。値は YYYY-MM-DD。
  const [popupDate, setPopupDate] = useState<string | null>(null);

  const total = daysInMonth(targetMonth);
  const days = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);

  const held = useMemo(() => new Set(scheduledDates), [scheduledDates]);
  const heldDays = days.filter((d) => held.has(dayStr(targetMonth, d)));

  function openEdit() {
    setSelectedDates(new Set(scheduledDates));
    setError(null);
    setEditOpen(true);
  }

  function toggleDate(date: string) {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function handleSave() {
    setError(null);
    if (selectedDates.size === 0) {
      setError(t.errors.scheduledDatesRequired);
      return;
    }
    startTransition(async () => {
      try {
        await updateLineDatesAction({
          id: lineEventId,
          scheduledDates: Array.from(selectedDates).sort(),
        });
        toast.success(c.saved);
        setEditOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  // ポップアップタイトル「YYYY年M月D日(曜)」。
  const popupTitle = useMemo(() => {
    if (!popupDate) return "";
    const [y, m, d] = popupDate.split("-").map(Number);
    const dow = new Date(y!, m! - 1, d!).getDay();
    return t.datePopup.titleFormat
      .replace("{year}", String(y))
      .replace("{month}", String(m))
      .replace("{day}", String(d))
      .replace("{dow}", DAY_LABELS[dow] ?? "");
  }, [popupDate, t.datePopup.titleFormat]);

  // 日付ポップアップで表示する報告一式（開始/終了/成果）。デモ値を決定論的に生成。
  const popupReports = useMemo(
    () =>
      popupDate
        ? buildDemoEventReports(`${lineEventId}-${popupDate}`, { date: popupDate, venuePlace })
        : null,
    [popupDate, lineEventId, venuePlace],
  );

  // アポ取り顧客（成果のアポ数に揃えた件数を生成）。
  const popupAppointments = useMemo(
    () =>
      popupReports && popupDate
        ? buildDemoAppointments(`${lineEventId}-${popupDate}`, popupReports.result.apptTotal, {
            date: popupDate,
          })
        : [],
    [popupReports, lineEventId, popupDate],
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">{t.sections.schedule}</CardTitle>
          <Button variant="outline" size="sm" onClick={openEdit}>
            {t.editSchedule.button}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* 左: 月カレンダー（月曜始まり） */}
            <div className="lg:col-span-2">
              <div className="rounded-md border border-hairline-light p-3">
                {/* 曜日ヘッダー */}
                <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                  {MON_WEEK_LABELS.map((d, i) => (
                    <div
                      key={d}
                      className={[
                        "text-center text-xs font-medium",
                        i === 5 ? "text-link-light" : i === 6 ? "text-warning" : "text-mute-light",
                      ].join(" ")}
                    >
                      {d}
                    </div>
                  ))}
                </div>
                {/* 日付グリッド */}
                <div className="grid grid-cols-7 gap-1.5">
                  {Array.from({ length: total > 0 ? mondayColumn(dayOfWeek(targetMonth, 1)) : 0 }).map(
                    (_, i) => (
                      <div
                        key={`blank-${i}`}
                        className="rounded-md border border-hairline-light/50 bg-surface-soft/40 py-2.5"
                      />
                    ),
                  )}
                  {days.map((day) => {
                    const ds = dayStr(targetMonth, day);
                    const isHeld = held.has(ds);
                    return (
                      <button
                        key={ds}
                        type="button"
                        onClick={isHeld ? () => setPopupDate(ds) : undefined}
                        disabled={!isHeld}
                        className={[
                          "relative flex flex-col items-center justify-center rounded-md border py-2.5 text-sm",
                          isHeld
                            ? "border-primary bg-primary text-white font-semibold cursor-pointer hover:shadow-sm"
                            : "border-hairline-light text-body-light cursor-default",
                        ].join(" ")}
                      >
                        <span className="tabular-nums leading-tight">{day}</span>
                        {isHeld && (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                            className="mt-0.5"
                          >
                            <path
                              d="M2.5 6L5 8.5L9.5 3.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
                {/* 凡例 */}
                <div className="mt-3 flex items-center gap-4 text-xs text-mute-light">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm bg-primary" />
                    {t.calendar.held}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm border border-hairline-light/50 bg-surface-soft/40" />
                    {t.calendar.outOfRange}
                  </span>
                </div>
              </div>
            </div>

            {/* 右: 開催予定日 / 開催回数 / 備考 */}
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium text-mute-light mb-2">
                  {t.calendar.scheduledDatesHeading}
                </p>
                {heldDays.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {heldDays.map((day) => {
                      const { text, dow } = chipLabel(targetMonth, day);
                      const ds = dayStr(targetMonth, day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setPopupDate(ds)}
                          className={[
                            "inline-flex items-center rounded-full border border-hairline-light bg-surface-soft/40 px-2.5 py-1 text-xs font-medium tabular-nums cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors",
                            dowColor(dow),
                          ].join(" ")}
                        >
                          {text}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-mute-light">—</p>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-mute-light mb-1">{t.calendar.holdingCount}</p>
                <p className="text-sm font-semibold text-ink">
                  {scheduledDates.length}
                  {t.holdingCountSuffix}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-mute-light mb-1">{t.calendar.note}</p>
                <p className="text-sm text-ink whitespace-pre-wrap">{contractNote || "—"}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 開催日編集ダイアログ — 登録ダイアログのカレンダーUI（月曜始まり）を踏襲 */}
      <Dialog
        open={editOpen}
        onOpenChange={(next) => {
          setEditOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.editSchedule.dialogTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-2 mt-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-mute-light">
                {t.fields.scheduledDates} <span className="text-warning">*</span>
              </label>
              <span className="text-xs text-mute-light tabular-nums">
                {t.form.selectedCount.replace("{n}", String(selectedDates.size))}
              </span>
            </div>
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
                {Array.from({
                  length: total > 0 ? mondayColumn(dayOfWeek(targetMonth, 1)) : 0,
                }).map((_, i) => (
                  <div key={`blank-${i}`} aria-hidden />
                ))}
                {days.map((day) => {
                  const ds = dayStr(targetMonth, day);
                  const dow = dayOfWeek(targetMonth, day);
                  const checked = selectedDates.has(ds);
                  const numColor = dow === 0 ? "text-warning" : dow === 6 ? "text-link-light" : "";
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

            {error && (
              <p role="alert" className="text-sm font-medium text-warning">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                {c.cancel}
              </Button>
              <Button type="button" onClick={handleSave} disabled={pending}>
                {pending ? c.saving : t.editSchedule.save}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 日付ポップアップ — 報告/アポはプレースホルダー（将来データ連携時に差し込む） */}
      <Dialog open={popupDate != null} onOpenChange={(next) => !next && setPopupDate(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{popupTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-2">
            {/* 報告（開始/終了/成果）— 入れ子ダイアログにせずポップアップ内に直接表示。 */}
            {popupReports ? <EventReportsView reports={popupReports} /> : null}

            {/* アポ取り顧客一覧 — イベントで獲得したアポ顧客（デモ値、成果のアポ数に整合） */}
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">{t.datePopup.appointmentSection}</p>
              <AcquiredAppointmentsTable customers={popupAppointments} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
