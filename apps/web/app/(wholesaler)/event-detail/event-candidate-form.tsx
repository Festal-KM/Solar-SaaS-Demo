"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import {
  createEventCandidateAction,
  updateEventCandidateAction,
  type UpdateEventCandidateInput,
} from "./actions";

import type { ActiveVenueProviderOption } from "./data";
import type {
  EventCandidateInput,
  EventCandidateStatus,
  EventCandidateUpdate,
} from "@solar/contracts";

// S-024 の新規作成 / 編集フォーム。
//
// 編集モード時の挙動:
//   - DRAFT     : 全フィールド編集可
//   - その他    : 回答期限と内部メモのみ編集可（他フィールドは disabled、
//                 actions 側でも validation で弾く）
//
// 固定費 / 成果報酬率 / 内部メモ は卸業者内部用フィールドであることを UI で
// 明示する（i18n のラベルに「(内部)」/ 注意書きを含める）。

type Mode =
  | { kind: "create" }
  | {
      kind: "edit";
      id: string;
      status: EventCandidateStatus;
      initial: {
        venueProviderId: string | null;
        targetMonth: string;
        scheduledDate: string;
        storeName: string;
        address: string | null;
        area: string | null;
        deadlineAt: string;
        contractType: "FIXED" | "PERFORMANCE" | "OTHER" | null;
        fixedFee: string | null;
        performanceRate: string | null;
        internalNote: string | null;
      };
    };

interface EventCandidateFormProps {
  mode: Mode;
  venueProviders: ActiveVenueProviderOption[];
}

interface FormState {
  venueProviderId: string;
  targetMonth: string;
  scheduledDate: string;
  storeName: string;
  address: string;
  area: string;
  deadlineAt: string;
  contractType: "" | "FIXED" | "PERFORMANCE" | "OTHER";
  fixedFee: string;
  performanceRate: string;
  internalNote: string;
}

function toDatetimeLocal(iso: string): string {
  // <input type="datetime-local"> wants yyyy-MM-ddTHH:mm in the user's local
  // timezone. ISO strings come back as UTC; subtract the offset before slicing.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function toDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function toFormState(mode: Mode): FormState {
  if (mode.kind === "create") {
    return {
      venueProviderId: "",
      targetMonth: "",
      scheduledDate: "",
      storeName: "",
      address: "",
      area: "",
      deadlineAt: "",
      contractType: "",
      fixedFee: "",
      performanceRate: "",
      internalNote: "",
    };
  }
  return {
    venueProviderId: mode.initial.venueProviderId ?? "",
    targetMonth: mode.initial.targetMonth,
    scheduledDate: toDateInput(mode.initial.scheduledDate),
    storeName: mode.initial.storeName,
    address: mode.initial.address ?? "",
    area: mode.initial.area ?? "",
    deadlineAt: toDatetimeLocal(mode.initial.deadlineAt),
    contractType: mode.initial.contractType ?? "",
    fixedFee: mode.initial.fixedFee ?? "",
    performanceRate: mode.initial.performanceRate ?? "",
    internalNote: mode.initial.internalNote ?? "",
  };
}

export function EventCandidateForm({ mode, venueProviders }: EventCandidateFormProps) {
  const router = useRouter();
  const t = labels.eventCandidate;
  const c = labels.common;

  const [values, setValues] = useState<FormState>(() => toFormState(mode));
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isEditing = mode.kind === "edit";
  const isDraft = !isEditing || mode.status === "DRAFT";
  // After publication only deadlineAt と internalNote のみ編集可。
  const lockedAfterPublish = isEditing && !isDraft;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(values.targetMonth)) {
      setServerError(t.errors.targetMonthFormat);
      return;
    }
    if (!values.scheduledDate) {
      setServerError(t.errors.scheduledDateRequired);
      return;
    }
    if (!values.storeName.trim()) {
      setServerError(t.errors.storeNameRequired);
      return;
    }
    if (!values.deadlineAt) {
      setServerError(t.errors.deadlineAtRequired);
      return;
    }

    const blank = (s: string) => (s.trim().length === 0 ? undefined : s.trim());
    const scheduledDate = new Date(values.scheduledDate);
    const deadlineAt = new Date(values.deadlineAt);

    startTransition(async () => {
      try {
        if (mode.kind === "create") {
          const payload: EventCandidateInput = {
            venueProviderId: blank(values.venueProviderId),
            targetMonth: values.targetMonth,
            scheduledDate,
            storeName: values.storeName.trim(),
            address: blank(values.address),
            area: blank(values.area),
            deadlineAt,
            contractType: values.contractType === "" ? undefined : values.contractType,
            fixedFee: blank(values.fixedFee),
            performanceRate: blank(values.performanceRate),
            internalNote: blank(values.internalNote),
          };
          const result = await createEventCandidateAction(payload);
          toast.success(c.saved);
          router.push(`/event-detail/${result.id}`);
        } else {
          // For DRAFT, send the full patch; otherwise send only the limited
          // editable subset (deadlineAt / internalNote). Sending forbidden
          // keys is rejected server-side anyway, but trimming here keeps the
          // wire payload aligned with the policy.
          const patch: EventCandidateUpdate = lockedAfterPublish
            ? {
                deadlineAt,
                internalNote: blank(values.internalNote),
              }
            : {
                venueProviderId: blank(values.venueProviderId),
                targetMonth: values.targetMonth,
                scheduledDate,
                storeName: values.storeName.trim(),
                address: blank(values.address),
                area: blank(values.area),
                deadlineAt,
                contractType: values.contractType === "" ? undefined : values.contractType,
                fixedFee: blank(values.fixedFee),
                performanceRate: blank(values.performanceRate),
                internalNote: blank(values.internalNote),
              };
          const input: UpdateEventCandidateInput = { id: mode.id, patch };
          await updateEventCandidateAction(input);
          toast.success(c.saved);
          router.refresh();
        }
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      <section className="space-y-4">
        <h2 className="text-lg font-medium">{t.sections.basic}</h2>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="venueProviderId">
            {t.fields.venueProvider}
          </label>
          <select
            id="venueProviderId"
            value={values.venueProviderId}
            onChange={(e) => update("venueProviderId", e.target.value)}
            disabled={lockedAfterPublish}
            className="border-input bg-background flex h-10 w-full rounded-md border px-3 py-2 text-sm"
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="storeName">
              {t.fields.storeName} <span className="text-destructive">*</span>
            </label>
            <Input
              id="storeName"
              value={values.storeName}
              onChange={(e) => update("storeName", e.target.value)}
              disabled={lockedAfterPublish}
              aria-required="true"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="area">
              {t.fields.area}
            </label>
            <Input
              id="area"
              value={values.area}
              onChange={(e) => update("area", e.target.value)}
              disabled={lockedAfterPublish}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium" htmlFor="address">
              {t.fields.address}
            </label>
            <Input
              id="address"
              value={values.address}
              onChange={(e) => update("address", e.target.value)}
              disabled={lockedAfterPublish}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">{t.sections.schedule}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="targetMonth">
              {t.fields.targetMonth} <span className="text-destructive">*</span>
            </label>
            <Input
              id="targetMonth"
              placeholder="2026-06"
              value={values.targetMonth}
              onChange={(e) => update("targetMonth", e.target.value)}
              disabled={lockedAfterPublish}
              aria-required="true"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="scheduledDate">
              {t.fields.scheduledDate} <span className="text-destructive">*</span>
            </label>
            <Input
              id="scheduledDate"
              type="date"
              value={values.scheduledDate}
              onChange={(e) => update("scheduledDate", e.target.value)}
              disabled={lockedAfterPublish}
              aria-required="true"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="deadlineAt">
              {t.fields.deadlineAt} <span className="text-destructive">*</span>
            </label>
            <Input
              id="deadlineAt"
              type="datetime-local"
              value={values.deadlineAt}
              onChange={(e) => update("deadlineAt", e.target.value)}
              aria-required="true"
            />
          </div>
        </div>
      </section>

      <section
        className="border-border bg-muted/20 space-y-4 rounded-md border border-dashed p-4"
        aria-label={t.sections.contract}
      >
        <div>
          <h2 className="text-lg font-medium">{t.sections.contract}</h2>
          <p className="text-muted-foreground text-xs">{t.internalOnlyNotice}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="contractType">
              {t.fields.contractType}
            </label>
            <select
              id="contractType"
              value={values.contractType}
              onChange={(e) => update("contractType", e.target.value as FormState["contractType"])}
              disabled={lockedAfterPublish}
              className="border-input bg-background flex h-10 w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">{c.notSet}</option>
              <option value="FIXED">{labels.venueProvider.contractTypes.FIXED}</option>
              <option value="PERFORMANCE">{labels.venueProvider.contractTypes.PERFORMANCE}</option>
              <option value="OTHER">{labels.venueProvider.contractTypes.OTHER}</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="fixedFee">
              {t.fields.fixedFee}
            </label>
            <Input
              id="fixedFee"
              inputMode="decimal"
              value={values.fixedFee}
              onChange={(e) => update("fixedFee", e.target.value)}
              disabled={lockedAfterPublish}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="performanceRate">
              {t.fields.performanceRate}
            </label>
            <Input
              id="performanceRate"
              inputMode="decimal"
              value={values.performanceRate}
              onChange={(e) => update("performanceRate", e.target.value)}
              disabled={lockedAfterPublish}
            />
          </div>
        </div>
      </section>

      <section
        className="border-border bg-muted/20 space-y-4 rounded-md border border-dashed p-4"
        aria-label={t.sections.internal}
      >
        <div>
          <h2 className="text-lg font-medium">{t.sections.internal}</h2>
          <p className="text-muted-foreground text-xs">{t.internalOnlyNotice}</p>
        </div>
        <textarea
          rows={3}
          value={values.internalNote}
          onChange={(e) => update("internalNote", e.target.value)}
          className="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm"
          aria-label={t.fields.internalNote}
        />
      </section>

      {serverError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {serverError}
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {c.back}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending
            ? c.saving
            : mode.kind === "create"
              ? t.actions.createSubmit
              : t.actions.updateSubmit}
        </Button>
      </div>
    </form>
  );
}
