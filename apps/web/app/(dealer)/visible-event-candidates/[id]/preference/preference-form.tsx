"use client";

// PreferenceForm — S-060 入力フォーム (T-03-06 / F-021 / docs/04 §1.5).
//
// shadcn の Form は zodResolver と SSR をまだ混ぜないので、ここでは素の
// useState + useTransition で軽量に組む（マスタ画面群と同じパターン）。
//
// 入力:
//   - priority (number, 任意)
//   - availableDates (改行区切り YYYY-MM-DD, 任意)
//   - staffCount (number, 任意)
//   - note (string, 任意)
//
// 本フォームは単一 EventCandidate に対する希望の submit / update / withdraw
// に責務を限定する。F-021 「1 件以上の候補に希望を出す」要件は、複数候補に
// 対して個別にこの画面を経由する形で UI 側で担保する（複数候補チェック式
// 一括 submit UI は別タスクへ申し送り）。
//
// 期限超過 (deadlinePassed=true) または候補が OPEN でないときはフォーム全体を
// disabled にし、取り下げボタンも出さない。サーバ側 (`submitPreferenceAction`)
// でも必ず再検証されるため、ここの disabled は UX 用のみ。

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { submitPreferenceAction, withdrawPreferenceAction } from "./actions";

import type { ExistingPreferenceView } from "./data";

interface PreferenceFormProps {
  eventCandidateId: string;
  relationshipId: string;
  targetMonth: string;
  existing: ExistingPreferenceView | null;
  disabled: boolean;
  disabledReason?: string | null;
}

// 改行区切り → string[] (空文字 / 空白だけは除外、trim 済み)。
function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// YYYY-MM-DD バリデーション。`new Date(...)` だけだと 'foo' が NaN にならない
// ロケール文字列で通る場合があるため、形式チェックを別に行う。
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function parseDateLines(input: string): { dates: Date[]; invalid: string[] } {
  const dates: Date[] = [];
  const invalid: string[] = [];
  for (const line of splitLines(input)) {
    if (!DATE_PATTERN.test(line)) {
      invalid.push(line);
      continue;
    }
    const d = new Date(`${line}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      invalid.push(line);
      continue;
    }
    dates.push(d);
  }
  return { dates, invalid };
}

function parseOptionalInt(value: string): { value: number | undefined; invalid: boolean } {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { value: undefined, invalid: false };
  if (!/^\d+$/.test(trimmed)) return { value: undefined, invalid: true };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: undefined, invalid: true };
  return { value: n, invalid: false };
}

export function PreferenceForm({
  eventCandidateId,
  relationshipId,
  targetMonth,
  existing,
  disabled,
  disabledReason,
}: PreferenceFormProps) {
  const router = useRouter();
  const t = labels.dealerPreference;
  const c = labels.common;

  const [priorityText, setPriorityText] = useState<string>(
    existing?.priority !== null && existing?.priority !== undefined
      ? String(existing.priority)
      : "",
  );
  const [availableDatesText, setAvailableDatesText] = useState<string>(
    existing?.availableDates
      ? existing.availableDates
          // 既存 ISO → YYYY-MM-DD (UTC 基準) に丸めて表示。
          .map((iso) => iso.slice(0, 10))
          .join("\n")
      : "",
  );
  const [staffCountText, setStaffCountText] = useState<string>(
    existing?.staffCount !== null && existing?.staffCount !== undefined
      ? String(existing.staffCount)
      : "",
  );
  const [noteText, setNoteText] = useState<string>(existing?.note ?? "");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isUpdate = !!existing;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setFieldErrors({});
    setServerError(null);

    const { dates: availableDates, invalid: invalidDates } = parseDateLines(availableDatesText);
    if (invalidDates.length > 0) {
      setFieldErrors({ availableDates: t.feedback.invalidDate });
      return;
    }

    const priorityParsed = parseOptionalInt(priorityText);
    if (priorityParsed.invalid) {
      setFieldErrors({ priority: t.feedback.invalidPriority });
      return;
    }
    const staffCountParsed = parseOptionalInt(staffCountText);
    if (staffCountParsed.invalid) {
      setFieldErrors({ staffCount: t.feedback.invalidStaffCount });
      return;
    }

    const noteTrimmed = noteText.trim();
    const payload = {
      eventCandidateId,
      relationshipId,
      targetMonth,
      ...(priorityParsed.value !== undefined ? { priority: priorityParsed.value } : {}),
      ...(availableDates.length > 0 ? { availableDates } : {}),
      ...(staffCountParsed.value !== undefined ? { staffCount: staffCountParsed.value } : {}),
      ...(noteTrimmed.length > 0 ? { note: noteTrimmed } : {}),
    };

    startTransition(async () => {
      try {
        const result = await submitPreferenceAction(payload);
        toast.success(result.created ? t.feedback.submitted : t.feedback.updated);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  function handleWithdraw() {
    if (disabled) return;
    if (!window.confirm(t.actions.withdrawConfirm)) return;
    setServerError(null);

    startTransition(async () => {
      try {
        await withdrawPreferenceAction({ eventCandidateId, relationshipId });
        toast.success(t.feedback.withdrawn);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {disabled && disabledReason ? (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-sm">
          {disabledReason}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pref-priority">{t.fields.priority}</Label>
          <Input
            id="pref-priority"
            name="priority"
            type="number"
            min={0}
            max={10}
            value={priorityText}
            onChange={(e) => setPriorityText(e.target.value)}
            disabled={disabled || pending}
            aria-invalid={!!fieldErrors.priority}
          />
          {fieldErrors.priority ? (
            <p role="alert" className="text-destructive text-sm">
              {fieldErrors.priority}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="pref-staff-count">{t.fields.staffCount}</Label>
          <Input
            id="pref-staff-count"
            name="staffCount"
            type="number"
            min={0}
            max={999}
            value={staffCountText}
            onChange={(e) => setStaffCountText(e.target.value)}
            disabled={disabled || pending}
            aria-invalid={!!fieldErrors.staffCount}
          />
          {fieldErrors.staffCount ? (
            <p role="alert" className="text-destructive text-sm">
              {fieldErrors.staffCount}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pref-available-dates">{t.fields.availableDates}</Label>
        <textarea
          id="pref-available-dates"
          name="availableDates"
          value={availableDatesText}
          onChange={(e) => setAvailableDatesText(e.target.value)}
          disabled={disabled || pending}
          rows={3}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
          aria-invalid={!!fieldErrors.availableDates}
          aria-describedby="pref-available-dates-hint"
        />
        <p id="pref-available-dates-hint" className="text-muted-foreground text-xs">
          {t.fields.availableDatesHint}
        </p>
        {fieldErrors.availableDates ? (
          <p role="alert" className="text-destructive text-sm">
            {fieldErrors.availableDates}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="pref-note">{t.fields.note}</Label>
        <textarea
          id="pref-note"
          name="note"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          disabled={disabled || pending}
          rows={3}
          maxLength={2000}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {serverError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {serverError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled || pending}>
          {pending
            ? isUpdate
              ? t.actions.updating
              : t.actions.submitting
            : isUpdate
              ? t.actions.update
              : t.actions.submit}
        </Button>
        {isUpdate ? (
          <Button
            type="button"
            variant="destructive"
            disabled={disabled || pending}
            onClick={handleWithdraw}
          >
            {pending ? t.actions.withdrawing : t.actions.withdraw}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
