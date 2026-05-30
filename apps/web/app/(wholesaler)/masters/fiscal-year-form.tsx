"use client";

// 年度開始月のみを編集する単項目フォーム (S-052「年度開始月」タブ用).
// `updateWholesalerSettingsAction` の patch セマンティクスを利用して
// `fiscalYearStartMonth` のみ送信する。

import { zodResolver } from "@hookform/resolvers/zod";
import { WholesalerSettingsUpdateSchema } from "@solar/contracts/schemas/wholesaler-settings";
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
import { labels } from "@/lib/i18n/labels";

import { updateWholesalerSettingsAction } from "./wholesaler-settings/actions";

const MONTHS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

const FormSchema = z.object({
  fiscalYearStartMonth: z
    .string()
    .min(1, "1〜12 月の範囲で入力してください")
    .refine((v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 12;
    }, "1〜12 月の範囲で入力してください"),
});

type FormValues = z.infer<typeof FormSchema>;

export interface FiscalYearFormProps {
  initial: {
    fiscalYearStartMonth: number;
  };
}

export function FiscalYearForm({ initial }: FiscalYearFormProps) {
  const router = useRouter();
  const t = labels.wholesalerSettings;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(FormSchema) as any,
    defaultValues: {
      fiscalYearStartMonth: String(initial.fiscalYearStartMonth),
    },
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    let payload: { fiscalYearStartMonth: number };
    try {
      payload = WholesalerSettingsUpdateSchema.parse({
        fiscalYearStartMonth: Number(values.fiscalYearStartMonth),
      }) as { fiscalYearStartMonth: number };
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
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
