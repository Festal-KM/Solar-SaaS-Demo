"use client";

// Client form for wholesaler-settings (T-02-07 / F-015 §F-016).
//
// 単一フォームで cancelDeadlineDays / fiscalYearStartMonth / piiMaskingMode を
// 同時編集。クライアントは Number 入力 + select を扱い、Server Action 側で
// canonical な WholesalerSettingsUpdateSchema を再パースする。

import { zodResolver } from "@hookform/resolvers/zod";
import {
  PiiMaskingModeSchema,
  WholesalerSettingsUpdateSchema,
  type PiiMaskingMode,
  type WholesalerSettingsUpdate,
} from "@solar/contracts/schemas/wholesaler-settings";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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

import { updateWholesalerSettingsAction } from "./actions";

const PII_MODES: readonly PiiMaskingMode[] = ["MASKED", "FULL", "PARTIAL"] as const;
const MONTHS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

// RHF 用 schema は string 入力（HTML 仕様）を受けて数値に変換する形式。
const FormSchema = z.object({
  cancelDeadlineDays: z
    .string()
    .min(1, "1〜90 日の範囲で入力してください")
    .refine((v) => /^\d+$/.test(v), "整数で入力してください")
    .refine((v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 90;
    }, "1〜90 日の範囲で入力してください"),
  fiscalYearStartMonth: z
    .string()
    .min(1, "1〜12 月の範囲で入力してください")
    .refine((v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 12;
    }, "1〜12 月の範囲で入力してください"),
  piiMaskingMode: PiiMaskingModeSchema,
});

type FormValues = z.infer<typeof FormSchema>;

export interface WholesalerSettingsFormProps {
  initial: {
    cancelDeadlineDays: number;
    fiscalYearStartMonth: number;
    piiMaskingMode: PiiMaskingMode;
  };
}

export function WholesalerSettingsForm({ initial }: WholesalerSettingsFormProps) {
  const router = useRouter();
  const t = labels.wholesalerSettings;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(FormSchema) as any,
    defaultValues: {
      cancelDeadlineDays: String(initial.cancelDeadlineDays),
      fiscalYearStartMonth: String(initial.fiscalYearStartMonth),
      piiMaskingMode: initial.piiMaskingMode,
    },
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    let payload: WholesalerSettingsUpdate;
    try {
      payload = WholesalerSettingsUpdateSchema.parse({
        cancelDeadlineDays: Number(values.cancelDeadlineDays),
        fiscalYearStartMonth: Number(values.fiscalYearStartMonth),
        piiMaskingMode: values.piiMaskingMode,
      });
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : c.unknownError;
      setServerError(message);
      return;
    }

    startTransition(async () => {
      try {
        await updateWholesalerSettingsAction(payload);
        toast.success(c.saved);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" noValidate>
        {/* キャンセル運用 */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t.sections.cancel}</h2>
          <FormField
            control={form.control}
            name="cancelDeadlineDays"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.cancelDeadlineDays} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={90}
                    step={1}
                    autoComplete="off"
                    aria-required="true"
                    className="max-w-[160px]"
                    {...field}
                  />
                </FormControl>
                <p className="text-muted-foreground text-xs">{t.helpers.cancelDeadlineDays}</p>
                <p className="text-muted-foreground text-xs">
                  {t.helpers.cancelDeadlineDaysWarning}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* 年度設定 */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t.sections.fiscalYear}</h2>
          <FormField
            control={form.control}
            name="fiscalYearStartMonth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.fiscalYearStartMonth} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full max-w-[200px] rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {MONTHS.map((m) => (
                      <option key={m} value={String(m)}>
                        {t.months[String(m) as keyof typeof t.months]}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <p className="text-muted-foreground text-xs">{t.helpers.fiscalYearStartMonth}</p>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* PII 表示制御 */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t.sections.privacy}</h2>
          <FormField
            control={form.control}
            name="piiMaskingMode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.piiMaskingMode} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full max-w-[280px] rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {PII_MODES.map((m) => (
                      <option key={m} value={m}>
                        {t.piiMaskingModes[m]}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <p className="text-muted-foreground text-xs">{t.helpers.piiMaskingMode}</p>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {serverError ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {serverError}
          </p>
        ) : null}

        <div className="flex items-center justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? c.saving : t.actions.save}
          </Button>
        </div>
      </form>
    </Form>
  );
}
