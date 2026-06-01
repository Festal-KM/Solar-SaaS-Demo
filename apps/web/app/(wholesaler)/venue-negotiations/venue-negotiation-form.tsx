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

// S-022 の新規作成 / 編集フォーム。実施候補日は input[type=date] の配列で
// 受け付け、actions.ts 側に `Date[]` として渡す。空欄行は無視し、yyyy-mm-dd
// 文字列のままだとブラウザのタイムゾーンに依存しないよう正午 UTC 起点で
// `Date` 化している。

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
  storeName: string; // mirrors VenueProvider.name; edits sync back via venueProviderUpdate
  address: string; // mirrors VenueProvider.address; same
  candidateDates: string[]; // yyyy-mm-dd strings, one per <input type=date> row
  contractType: "" | "FIXED" | "PERFORMANCE" | "OTHER";
  fixedFee: string;
  performanceRate: string;
  conditionNote: string;
  nextAction: string;
  note: string;
}

function toFormState(
  mode: Mode,
  providers: ActiveVenueProviderOption[],
): FormState {
  if (mode.kind === "create") {
    return {
      venueProviderId: "",
      storeName: "",
      address: "",
      candidateDates: [""],
      contractType: "",
      fixedFee: "",
      performanceRate: "",
      conditionNote: "",
      nextAction: "",
      note: "",
    };
  }
  const selected = providers.find((v) => v.id === mode.initial.venueProviderId);
  return {
    venueProviderId: mode.initial.venueProviderId,
    storeName: selected?.name ?? "",
    address: selected?.address ?? "",
    candidateDates:
      mode.initial.candidateDates.length > 0
        ? mode.initial.candidateDates.map((iso) => iso.slice(0, 10))
        : [""],
    contractType: mode.initial.contractType ?? "",
    fixedFee: mode.initial.fixedFee ?? "",
    performanceRate: mode.initial.performanceRate ?? "",
    conditionNote: mode.initial.conditionNote ?? "",
    nextAction: mode.initial.nextAction ?? "",
    note: mode.initial.note ?? "",
  };
}

function parseCandidateDates(values: string[]): Date[] {
  return values
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    // Anchor to 12:00 UTC so the calendar date matches across timezones —
    // a yyyy-mm-dd without a time would otherwise be interpreted as
    // midnight UTC which displays as the previous day in JST.
    .map((s) => new Date(`${s}T12:00:00.000Z`))
    .filter((d) => !Number.isNaN(d.getTime()));
}

export function VenueNegotiationForm({ mode, venueProviders }: VenueNegotiationFormProps) {
  const router = useRouter();
  const t = labels.venueNegotiation;
  const c = labels.common;

  const [values, setValues] = useState<FormState>(() => toFormState(mode, venueProviders));
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  // When the user picks a different venue provider, autofill the editable
  // 店舗名 / 住所 fields from the selected master. The user can still edit
  // them inline afterward — the edits flow back to VenueProvider on save.
  function selectVenueProvider(id: string) {
    const next = venueProviders.find((v) => v.id === id);
    setValues((prev) => ({
      ...prev,
      venueProviderId: id,
      storeName: next?.name ?? "",
      address: next?.address ?? "",
    }));
  }

  function updateCandidateDate(index: number, value: string) {
    setValues((prev) => {
      const next = [...prev.candidateDates];
      next[index] = value;
      return { ...prev, candidateDates: next };
    });
  }

  function addCandidateDate() {
    setValues((prev) => ({ ...prev, candidateDates: [...prev.candidateDates, ""] }));
  }

  function removeCandidateDate(index: number) {
    setValues((prev) => {
      const next = prev.candidateDates.filter((_, i) => i !== index);
      return { ...prev, candidateDates: next.length > 0 ? next : [""] };
    });
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
          // Detect inline 店舗名 / 住所 edits and forward them to the linked
          // VenueProvider master. Skip the side-update when the values match
          // the currently selected provider verbatim — no useless writes.
          const selected = venueProviders.find((v) => v.id === values.venueProviderId);
          const providerUpdate: { name?: string; address?: string } = {};
          if (selected && values.storeName.trim() && values.storeName.trim() !== selected.name) {
            providerUpdate.name = values.storeName.trim();
          }
          if (selected && values.address.trim() !== (selected.address ?? "").trim()) {
            providerUpdate.address = values.address.trim();
          }
          const patch: UpdateVenueNegotiationInput = {
            id: mode.id,
            patch: payload,
            ...(Object.keys(providerUpdate).length > 0
              ? { venueProviderUpdate: providerUpdate }
              : {}),
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
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <div className="flex h-5 items-center">
            <label className="text-sm font-medium leading-none" htmlFor="venueProviderId">
              {t.fields.venueProvider} <span className="text-destructive">*</span>
            </label>
          </div>
          <select
            id="venueProviderId"
            value={values.venueProviderId}
            onChange={(e) => selectVenueProvider(e.target.value)}
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
          <div className="flex h-5 items-center">
            <label className="text-sm font-medium leading-none" htmlFor="storeName">
              {t.fields.storeName}
            </label>
          </div>
          <Input
            id="storeName"
            value={values.storeName}
            onChange={(e) => update("storeName", e.target.value)}
            disabled={!values.venueProviderId}
          />
        </div>
        <div className="space-y-2">
          <div className="flex h-5 items-center justify-between gap-2">
            <span className="text-sm font-medium leading-none">
              {t.fields.candidateDates} <span className="text-destructive">*</span>
            </span>
            <button
              type="button"
              onClick={addCandidateDate}
              className="text-electric-blue hover:text-electric-blue/80 text-xs font-medium leading-none underline-offset-2 hover:underline"
            >
              + 候補日を追加
            </button>
          </div>
          <ul className="space-y-2">
            {values.candidateDates.map((value, index) => (
              <li key={index} className="flex items-center gap-2">
                <Input
                  type="date"
                  value={value}
                  onChange={(e) => updateCandidateDate(index, e.target.value)}
                  aria-label={`${t.fields.candidateDates} ${index + 1}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCandidateDate(index)}
                  disabled={values.candidateDates.length <= 1 && value === ""}
                  aria-label={`${t.fields.candidateDates} ${index + 1} を削除`}
                >
                  −
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="address">
          {t.fields.address}
        </label>
        <Input
          id="address"
          value={values.address}
          onChange={(e) => update("address", e.target.value)}
          disabled={!values.venueProviderId}
        />
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-bold" htmlFor="contractType">
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
        {values.contractType === "FIXED" ? (
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
        ) : values.contractType === "PERFORMANCE" ? (
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
        ) : (
          <div aria-hidden />
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="conditionNote">
          {t.sections.condition}
        </label>
        <textarea
          id="conditionNote"
          rows={3}
          value={values.conditionNote}
          onChange={(e) => update("conditionNote", e.target.value)}
          className="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="note">
          {t.fields.note}
        </label>
        <textarea
          id="note"
          rows={4}
          value={values.note}
          onChange={(e) => update("note", e.target.value)}
          className="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

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
