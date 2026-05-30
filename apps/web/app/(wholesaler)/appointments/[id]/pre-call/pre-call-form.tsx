"use client";

// Pre-call record form (S-035 / T-04-09 / F-035).
//
// Shown only when no PreCall record exists yet.
// Shows the rescheduledAt date-time input only when result === RESCHEDULED.

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { PreCallResultEnum } from "@solar/contracts";
import type { PreCallRecordInput, PreCallResult } from "@solar/contracts";
import { z } from "zod";

import type { recordPreCallAction } from "./actions";

const RESULTS: PreCallResult[] = ["APPROVED", "ABSENT", "CALLBACK", "CANCELLED", "RESCHEDULED"];

const ClientSchema = z
  .object({
    result: PreCallResultEnum,
    notes: z.string().max(2000).optional().default(""),
    rescheduledAt: z.string().optional().default(""),
  })
  .refine(
    (val) => {
      if (val.result === "RESCHEDULED" && !val.rescheduledAt) return false;
      return true;
    },
    {
      message: "日程変更の場合は新しい訪問予定日時を入力してください",
      path: ["rescheduledAt"],
    },
  );

type FormValues = z.infer<typeof ClientSchema>;

interface Props {
  appointmentId: string;
  action: typeof recordPreCallAction;
}

export function PreCallForm({ appointmentId, action }: Props) {
  const t = labels.preCall;
  const c = labels.common;
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(ClientSchema) as any,
    defaultValues: { result: "APPROVED", notes: "", rescheduledAt: "" },
  });

  const watchedResult = form.watch("result");

  function onSubmit(values: FormValues) {
    setServerError(null);
    startTransition(async () => {
      try {
        const input: PreCallRecordInput = {
          appointmentId,
          result: values.result,
          notes: values.notes || undefined,
          rescheduledAt: values.result === "RESCHEDULED" && values.rescheduledAt
            ? new Date(values.rescheduledAt).toISOString()
            : undefined,
        };
        await action(input);
        toast.success(t.feedback.recorded);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  return (
    <div className="rounded-md border p-6">
      <h2 className="mb-4 text-lg font-medium">{t.recordTitle}</h2>
      <p className="text-muted-foreground mb-6 text-sm">{t.recordDescription}</p>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
          <FormField
            control={form.control}
            name="result"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.result} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                    aria-required="true"
                  >
                    {RESULTS.map((r) => (
                      <option key={r} value={r}>
                        {t.results[r]}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {watchedResult === "RESCHEDULED" && (
            <FormField
              control={form.control}
              name="rescheduledAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t.fields.rescheduledAt} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="datetime-local" aria-required="true" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.notes}</FormLabel>
                <FormControl>
                  <textarea
                    rows={3}
                    className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {serverError ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {serverError}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? t.actions.recording : t.actions.record}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
