"use client";

// キャンセル期限のみを編集する単項目フォーム (S-052「キャンセル期限」タブ用).
// 既存 `WholesalerSettingsForm` を 1 フィールドに切り出した派生版。
// 同じ Server Action `updateWholesalerSettingsAction` (patch セマンティクス) を
// 叩くため、ここでは `cancelDeadlineDays` のみ送信し、他フィールドには触れない。

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
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { updateWholesalerSettingsAction } from "./wholesaler-settings/actions";

const FormSchema = z.object({
  cancelDeadlineDays: z
    .string()
    .min(1, "1〜90 日の範囲で入力してください")
    .refine((v) => /^\d+$/.test(v), "整数で入力してください")
    .refine((v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 90;
    }, "1〜90 日の範囲で入力してください"),
});

type FormValues = z.infer<typeof FormSchema>;

export interface CancelDeadlineFormProps {
  initial: {
    cancelDeadlineDays: number;
  };
}

export function CancelDeadlineForm({ initial }: CancelDeadlineFormProps) {
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
    },
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    let payload: { cancelDeadlineDays: number };
    try {
      payload = WholesalerSettingsUpdateSchema.parse({
        cancelDeadlineDays: Number(values.cancelDeadlineDays),
      }) as { cancelDeadlineDays: number };
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
              <p className="text-muted-foreground text-xs">{t.helpers.cancelDeadlineDaysWarning}</p>
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
