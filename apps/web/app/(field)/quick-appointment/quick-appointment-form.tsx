"use client";

// S-057 — 現場フォーム: アポ顧客登録 (T-04-11 / F-031 / F-033 / docs/04 §1.4).
//
// Sheet ベースのスマホ最適化フォーム。FieldDashboardPage から呼び出される。
// 今日の催事 ID (`sourceEventId`) は親から渡されるので入力不要（表示のみ）。

import { zodResolver } from "@hookform/resolvers/zod";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { labels } from "@/lib/i18n/labels";

import type { QuickAppointmentResult } from "./actions";

const FormSchema = z.object({
  name: z.string().trim().min(1, "氏名を入力してください").max(255),
  phone: z.string().trim().min(1, "電話番号を入力してください").max(50),
  scheduledAt: z.string().min(1, "訪問予定日時を入力してください"),
  note: z.string().max(2000).optional().default(""),
});

type FormValues = z.infer<typeof FormSchema>;

export interface QuickAppointmentFormProps {
  /** Today's event ID pre-filled from the field staff's shift. */
  sourceEventId: string;
  onSubmitAction: (input: {
    name: string;
    phone: string;
    sourceEventId: string;
    scheduledAt: string;
    note?: string;
  }) => Promise<QuickAppointmentResult>;
}

export function QuickAppointmentForm({
  sourceEventId,
  onSubmitAction,
}: QuickAppointmentFormProps) {
  const l = labels.fieldQuickAppointment;
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(FormSchema) as any,
    defaultValues: {
      name: "",
      phone: "",
      scheduledAt: "",
      note: "",
    },
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    const blank = (s: string | undefined) => (s?.trim() ? s.trim() : undefined);

    startTransition(async () => {
      try {
        const result = await onSubmitAction({
          name: values.name.trim(),
          phone: values.phone.trim(),
          sourceEventId,
          scheduledAt: new Date(values.scheduledAt).toISOString(),
          note: blank(values.note),
        });

        if (result.duplicatePhoneWarning) {
          toast.warning(labels.customer.feedback.duplicatePhone);
        } else {
          toast.success(l.successToast);
        }

        form.reset();
        setOpen(false);
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : labels.common.unknownError;
        setServerError(message);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="lg" className="w-full">
          {l.openButton}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-xl pb-8">
        <SheetHeader className="mb-4">
          <SheetTitle>{l.sheetTitle}</SheetTitle>
          <SheetDescription>{l.sheetDescription}</SheetDescription>
        </SheetHeader>

        {/* Readonly event ID indicator */}
        <div className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {l.fields.sourceEventId}: <span className="font-mono">{sourceEventId}</span>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* 顧客情報 */}
            <section className="space-y-4">
              <p className="text-sm font-medium">{l.sections.customer}</p>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {l.fields.name} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="off"
                        aria-required="true"
                        inputMode="text"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {l.fields.phone} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        autoComplete="tel"
                        inputMode="tel"
                        aria-required="true"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>

            {/* アポ日程 */}
            <section className="space-y-4">
              <p className="text-sm font-medium">{l.sections.appointment}</p>
              <FormField
                control={form.control}
                name="scheduledAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {l.fields.scheduledAt} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        aria-required="true"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{l.fields.note}</FormLabel>
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
            </section>

            {serverError ? (
              <p role="alert" className="text-destructive text-sm font-medium">
                {serverError}
              </p>
            ) : null}

            <Button type="submit" disabled={pending} className="w-full" size="lg">
              {pending ? l.submitting : l.submitButton}
            </Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
