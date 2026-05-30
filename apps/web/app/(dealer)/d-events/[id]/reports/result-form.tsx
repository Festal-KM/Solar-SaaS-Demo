"use client";

// DealerResultReportForm — dealer perspective (T-04-04 / F-030 / docs/04 §1.5
// S-063 S-076).

import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { submitDealerResultReportAction } from "./actions";

interface DealerResultReportFormProps {
  eventId: string;
  hasDealerResult: boolean;
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

export function DealerResultReportForm({ eventId, hasDealerResult }: DealerResultReportFormProps) {
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
      await submitDealerResultReportAction({
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

  if (hasDealerResult) {
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
            <Label htmlFor={`dealer-${field}`}>{label}</Label>
            <Input
              id={`dealer-${field}`}
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
        <Label htmlFor="dealer-result-comment">{t.commentLabel}</Label>
        <textarea
          id="dealer-result-comment"
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
