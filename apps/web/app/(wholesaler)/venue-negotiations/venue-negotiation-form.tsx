"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import {
  createVenueNegotiationAction,
  updateVenueNegotiationAction,
  type UpdateVenueNegotiationInput,
} from "./actions";

import type { ActiveVenueProviderOption } from "./data";
import type { VenueNegotiationInput } from "@solar/contracts";

// S-022 の新規作成 / 編集フォーム。実施候補日は yyyy-mm-dd の改行区切りで
// 受け付け、actions.ts 側で `Date[]` に正規化する。

type Mode =
  | { kind: "create" }
  | {
      kind: "edit";
      id: string;
      initial: {
        venueProviderId: string;
        candidateDates: string[];
        contractType?: "FIXED" | "PERFORMANCE" | "OTHER";
        fixedFee?: string;
        performanceRate?: string;
        conditionNote?: string;
        nextAction?: string;
        note?: string;
      };
    };

interface VenueNegotiationFormProps {
  mode: Mode;
  venueProviders: ActiveVenueProviderOption[];
}

interface FormState {
  venueProviderId: string;
  candidateDates: string;
  contractType: "" | "FIXED" | "PERFORMANCE" | "OTHER";
  fixedFee: string;
  performanceRate: string;
  conditionNote: string;
  nextAction: string;
  note: string;
}

function toFormState(mode: Mode): FormState {
  if (mode.kind === "create") {
    return {
      venueProviderId: "",
      candidateDates: "",
      contractType: "",
      fixedFee: "",
      performanceRate: "",
      conditionNote: "",
      nextAction: "",
      note: "",
    };
  }
  return {
    venueProviderId: mode.initial.venueProviderId,
    candidateDates: mode.initial.candidateDates.join("\n"),
    contractType: mode.initial.contractType ?? "",
    fixedFee: mode.initial.fixedFee ?? "",
    performanceRate: mode.initial.performanceRate ?? "",
    conditionNote: mode.initial.conditionNote ?? "",
    nextAction: mode.initial.nextAction ?? "",
    note: mode.initial.note ?? "",
  };
}

function parseCandidateDates(text: string): Date[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => new Date(line))
    .filter((d) => !Number.isNaN(d.getTime()));
}

export function VenueNegotiationForm({ mode, venueProviders }: VenueNegotiationFormProps) {
  const router = useRouter();
  const t = labels.venueNegotiation;
  const c = labels.common;

  const [values, setValues] = useState<FormState>(() => toFormState(mode));
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);

    if (!values.venueProviderId) {
      setServerError(t.errors.venueProviderRequired);
      return;
    }
    const dates = parseCandidateDates(values.candidateDates);
    if (dates.length === 0) {
      setServerError(t.errors.candidateDateRequired);
      return;
    }

    const blank = (s: string) => (s.trim().length === 0 ? undefined : s.trim());

    const payload: VenueNegotiationInput = {
      venueProviderId: values.venueProviderId,
      candidateDates: dates,
      contractType: values.contractType === "" ? undefined : values.contractType,
      fixedFee: blank(values.fixedFee),
      performanceRate: blank(values.performanceRate),
      conditionNote: blank(values.conditionNote),
      nextAction: blank(values.nextAction),
      note: blank(values.note),
    };

    startTransition(async () => {
      try {
        if (mode.kind === "create") {
          const result = await createVenueNegotiationAction(payload);
          toast.success(c.saved);
          router.push(`/venue-negotiations/${result.id}`);
        } else {
          const patch: UpdateVenueNegotiationInput = {
            id: mode.id,
            patch: payload,
          };
          await updateVenueNegotiationAction(patch);
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
            {t.fields.venueProvider} <span className="text-destructive">*</span>
          </label>
          <select
            id="venueProviderId"
            value={values.venueProviderId}
            onChange={(e) => update("venueProviderId", e.target.value)}
            disabled={mode.kind === "edit"}
            className="border-input bg-background flex h-10 w-full rounded-md border px-3 py-2 text-sm"
            aria-required="true"
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
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="candidateDates">
            {t.fields.candidateDates} <span className="text-destructive">*</span>
          </label>
          <textarea
            id="candidateDates"
            rows={4}
            value={values.candidateDates}
            onChange={(e) => update("candidateDates", e.target.value)}
            placeholder="2026-05-01&#10;2026-05-08"
            className="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm"
            aria-required="true"
          />
          <p className="text-muted-foreground text-xs">
            yyyy-mm-dd 形式で 1 行に 1 日付。複数候補日を入力可能。
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="nextAction">
            {t.fields.nextAction}
          </label>
          <Input
            id="nextAction"
            value={values.nextAction}
            onChange={(e) => update("nextAction", e.target.value)}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">{t.sections.contract}</h2>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="contractType">
            {t.fields.contractType}
          </label>
          <select
            id="contractType"
            value={values.contractType}
            onChange={(e) => update("contractType", e.target.value as FormState["contractType"])}
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
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">{t.sections.condition}</h2>
        <textarea
          rows={3}
          value={values.conditionNote}
          onChange={(e) => update("conditionNote", e.target.value)}
          className="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm"
          aria-label={t.fields.conditionNote}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">{t.fields.note}</h2>
        <textarea
          rows={4}
          value={values.note}
          onChange={(e) => update("note", e.target.value)}
          className="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm"
          aria-label={t.fields.note}
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
