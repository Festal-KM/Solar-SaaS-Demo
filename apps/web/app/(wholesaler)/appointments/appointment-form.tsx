"use client";

// Shared appointment create / edit form (T-04-08 / S-034 / S-074).
//
// Props:
//   mode           — { kind: "create", initialCustomerId? } | { kind: "edit", id, initial }
//   onSubmitAction — server action to invoke
//   redirectTo     — path to push after successful create

import { zodResolver } from "@hookform/resolvers/zod";
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

export interface AppointmentFormResult {
  id: string;
}

const FormSchema = z.object({
  customerId: z.string().trim().min(1, "顧客 ID を入力してください"),
  eventId: z.string().optional().default(""),
  scheduledAt: z.string().min(1, "訪問予定日時を入力してください"),
  location: z.string().optional().default(""),
  appointmentType: z.string().optional().default(""),
  note: z.string().optional().default(""),
});

type FormValues = z.infer<typeof FormSchema>;

export interface AppointmentFormInitial {
  customerId: string;
  eventId?: string;
  scheduledAt: string;
  location?: string;
  appointmentType?: string;
  note?: string;
}

type Mode =
  | { kind: "create"; initialCustomerId?: string }
  | { kind: "edit"; id: string; initial: AppointmentFormInitial };

export interface AppointmentFormSubmitInput {
  customerId: string;
  eventId?: string;
  scheduledAt: string;
  location?: string;
  appointmentType?: string;
  note?: string;
  id?: string;
}

export interface AppointmentFormProps {
  mode: Mode;
  onSubmitAction: (input: AppointmentFormSubmitInput) => Promise<AppointmentFormResult>;
  redirectTo?: string;
}

function toFormValues(mode: Mode): FormValues {
  if (mode.kind === "edit") {
    const i = mode.initial;
    return {
      customerId: i.customerId,
      eventId: i.eventId ?? "",
      scheduledAt: i.scheduledAt.slice(0, 16), // datetime-local format
      location: i.location ?? "",
      appointmentType: i.appointmentType ?? "",
      note: i.note ?? "",
    };
  }
  return {
    customerId: mode.initialCustomerId ?? "",
    eventId: "",
    scheduledAt: "",
    location: "",
    appointmentType: "",
    note: "",
  };
}

export function AppointmentForm({ mode, onSubmitAction, redirectTo }: AppointmentFormProps) {
  const router = useRouter();
  const t = labels.appointment;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(FormSchema) as any,
    defaultValues: toFormValues(mode),
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    const blank = (s: string | undefined) => (s?.trim() ? s.trim() : undefined);

    startTransition(async () => {
      try {
        const result = await onSubmitAction({
          ...(mode.kind === "edit" ? { id: mode.id } : {}),
          customerId: values.customerId.trim(),
          eventId: blank(values.eventId),
          scheduledAt: new Date(values.scheduledAt).toISOString(),
          location: blank(values.location),
          appointmentType: blank(values.appointmentType),
          note: blank(values.note),
        });

        toast.success(c.saved);
        if (mode.kind === "create") {
          router.push(redirectTo ?? `/appointments/${result.id}`);
        } else {
          router.refresh();
        }
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" noValidate>
        {/* 基本情報 */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.basic}</h2>
          <FormField
            control={form.control}
            name="customerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.customerId} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input autoComplete="off" aria-required="true" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="eventId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.eventId}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="appointmentType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.appointmentType}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* 日程 */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.schedule}</h2>
          <FormField
            control={form.control}
            name="scheduledAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.scheduledAt} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input type="datetime-local" aria-required="true" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="location"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.location}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* 備考 */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.note}</h2>
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.note}</FormLabel>
                <FormControl>
                  <textarea
                    rows={4}
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
    </Form>
  );
}
