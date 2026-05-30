"use client";

// ResultReportForm — wholesaler perspective (T-04-04 / F-030 / docs/04 §1.3
// S-031). Renders a numeric input form for approach / survey / appointment
// counts and delegates to submitResultReportAction.
//
// Disabled when a RESULT report already exists for WHOLESALER.

import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { submitResultReportAction } from "./actions";

interface ResultReportFormProps {
  eventId: string;
  hasWholesalerResult: boolean;
}

interface FormState {
  approachCount: string;
  surveyCount: string;
  totalAppts: string;
  validAppts: string;
  invalidAppts: string;
  comment: string;
}

const EMPTY: FormState = {
  approachCount: "",
  surveyCount: "",
  totalAppts: "",
  validAppts: "",
  invalidAppts: "",
  comment: "",
};

function parseNonNegInt(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function ResultReportForm({ eventId, hasWholesalerResult }: ResultReportFormProps) {
  const t = labels.eventReport;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function handleChange(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      setFieldError(null);
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const approachCount = parseNonNegInt(form.approachCount);
    const surveyCount = parseNonNegInt(form.surveyCount);
    const totalAppts = parseNonNegInt(form.totalAppts);
    const validAppts = parseNonNegInt(form.validAppts);
    const invalidAppts = parseNonNegInt(form.invalidAppts);

    if (
      approachCount === null ||
      surveyCount === null ||
      totalAppts === null ||
      validAppts === null ||
      invalidAppts === null
    ) {
      setFieldError(t.result.negativeError);
      return;
    }

    if (validAppts + invalidAppts > totalAppts) {
      setFieldError(t.result.apptsSumError);
      return;
    }

    setSubmitting(true);
    try {
      await submitResultReportAction({
        eventId,
        approachCount,
        surveyCount,
        totalAppts,
        validAppts,
        invalidAppts,
        comment: form.comment || undefined,
      });
      toast.success(t.resultSuccess);
      setForm(EMPTY);
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes("すでに")
          ? t.conflictError
          : t.unknownError;
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (hasWholesalerResult) {
    return (
      <p className="text-muted-foreground text-sm">{t.resultAlreadySubmitted}</p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {(
          [
            ["approachCount", t.result.approachCount],
            ["surveyCount", t.result.surveyCount],
            ["totalAppts", t.result.totalAppts],
            ["validAppts", t.result.validAppts],
            ["invalidAppts", t.result.invalidAppts],
          ] as [keyof FormState, string][]
        ).map(([field, label]) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={field}>{label}</Label>
            <Input
              id={field}
              type="number"
              min={0}
              step={1}
              value={form[field]}
              onChange={handleChange(field)}
              required
              disabled={submitting}
              className="w-full"
            />
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <Label htmlFor="result-comment">{t.commentLabel}</Label>
        <textarea
          id="result-comment"
          value={form.comment}
          onChange={handleChange("comment")}
          placeholder={t.commentPlaceholder}
          rows={3}
          disabled={submitting}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {fieldError ? (
        <p role="alert" className="text-destructive text-sm">
          {fieldError}
        </p>
      ) : null}

      <Button type="submit" size="sm" disabled={submitting}>
        {submitting ? t.submitting : t.submitResult}
      </Button>
    </form>
  );
}
