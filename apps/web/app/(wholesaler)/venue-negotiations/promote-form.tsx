"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { promoteToCandidateAction } from "./actions";

import type { VenueNegotiationStatus } from "@solar/contracts";

// S-022 — 「イベント候補に昇格」フォーム。`FIXED` のときのみ表示される。

interface PromoteFormProps {
  id: string;
  status: VenueNegotiationStatus;
  defaultStoreName?: string;
  defaultArea?: string | null;
}

interface FormState {
  targetMonth: string;
  scheduledDate: string;
  storeName: string;
  address: string;
  area: string;
  deadlineAt: string;
}

export function PromoteForm({ id, status, defaultStoreName, defaultArea }: PromoteFormProps) {
  const router = useRouter();
  const t = labels.venueNegotiation;
  const c = labels.common;

  const [values, setValues] = useState<FormState>({
    targetMonth: "",
    scheduledDate: "",
    storeName: defaultStoreName ?? "",
    address: "",
    area: defaultArea ?? "",
    deadlineAt: "",
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status !== "FIXED") {
    return <p className="text-muted-foreground text-sm">{t.promote.requiresFixed}</p>;
  }

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
    if (!values.storeName.trim()) {
      setServerError(t.errors.storeNameRequired);
      return;
    }
    if (!values.scheduledDate) {
      setServerError(c.unknownError);
      return;
    }
    if (!values.deadlineAt) {
      setServerError(c.unknownError);
      return;
    }

    const scheduledDate = new Date(values.scheduledDate);
    const deadlineAt = new Date(values.deadlineAt);

    startTransition(async () => {
      try {
        const result = await promoteToCandidateAction({
          id,
          candidate: {
            targetMonth: values.targetMonth,
            scheduledDate,
            storeName: values.storeName.trim(),
            address: values.address.trim() || undefined,
            area: values.area.trim() || undefined,
            deadlineAt,
          },
        });
        toast.success(c.saved);
        router.push(`/event-detail/${result.eventCandidateId}`);
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-muted-foreground text-sm">{t.promote.description}</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="targetMonth">
            {t.promote.targetMonth} <span className="text-destructive">*</span>
          </label>
          <Input
            id="targetMonth"
            placeholder="2026-05"
            value={values.targetMonth}
            onChange={(e) => update("targetMonth", e.target.value)}
            aria-required="true"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="scheduledDate">
            {t.promote.scheduledDate} <span className="text-destructive">*</span>
          </label>
          <Input
            id="scheduledDate"
            type="date"
            value={values.scheduledDate}
            onChange={(e) => update("scheduledDate", e.target.value)}
            aria-required="true"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="storeName">
            {t.promote.storeName} <span className="text-destructive">*</span>
          </label>
          <Input
            id="storeName"
            value={values.storeName}
            onChange={(e) => update("storeName", e.target.value)}
            aria-required="true"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="area">
            {t.promote.area}
          </label>
          <Input id="area" value={values.area} onChange={(e) => update("area", e.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <label className="text-sm font-medium" htmlFor="address">
            {t.promote.address}
          </label>
          <Input
            id="address"
            value={values.address}
            onChange={(e) => update("address", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="deadlineAt">
            {t.promote.deadlineAt} <span className="text-destructive">*</span>
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

      {serverError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {serverError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t.actions.promoting : t.promote.submit}
        </Button>
      </div>
    </form>
  );
}
