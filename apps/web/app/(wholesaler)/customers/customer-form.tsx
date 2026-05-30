"use client";

// Shared customer registration / edit form (T-04-06 / S-033 / S-065).
//
// Used by both wholesaler new/edit pages and dealer new page.
// The `onSubmit` prop allows each caller to supply its own action
// (wholesaler vs. dealer variant differ in ownerRelationshipId handling).

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

export interface CustomerActionResult {
  id: string;
  duplicatePhoneWarning: boolean;
}

const FormSchema = z
  .object({
    name: z.string().trim().min(1, "氏名を入力してください").max(255),
    kana: z.string().max(255).optional().default(""),
    phone: z.string().trim().min(1, "電話番号を入力してください").max(50),
    email: z
      .string()
      .max(255)
      .optional()
      .default("")
      .refine((v) => v === "" || /.+@.+\..+/.test(v), "メールアドレスの形式が正しくありません"),
    postalCode: z.string().max(20).optional().default(""),
    address: z.string().max(500).optional().default(""),
    channel: z.enum(["EVENT", "WALK_IN", "TELE", "REFERRAL", "OTHER"]),
    sourceEventId: z.string().max(255).optional().default(""),
    note: z.string().max(2000).optional().default(""),
  })
  .superRefine((data, ctx) => {
    if (data.channel === "EVENT" && !data.sourceEventId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceEventId"],
        message: "催事チャネルでは催事 ID を指定してください",
      });
    }
  });

type FormValues = z.infer<typeof FormSchema>;

export interface CustomerFormInitial {
  name: string;
  kana?: string;
  phone: string;
  email?: string;
  postalCode?: string;
  address?: string;
  channel: "EVENT" | "WALK_IN" | "TELE" | "REFERRAL" | "OTHER";
  sourceEventId?: string;
  note?: string;
}

type Mode =
  | { kind: "create" }
  | { kind: "edit"; id: string; initial: CustomerFormInitial };

export interface CustomerFormValues {
  name: string;
  kana?: string;
  phone: string;
  email?: string;
  postalCode?: string;
  address?: string;
  channel: "EVENT" | "WALK_IN" | "TELE" | "REFERRAL" | "OTHER";
  sourceEventId?: string;
  note?: string;
  id?: string;
}

export interface CustomerFormProps {
  mode: Mode;
  /** Server action to invoke on submit. */
  onSubmitAction: (values: CustomerFormValues) => Promise<CustomerActionResult>;
  redirectTo?: string;
}

function toFormValues(initial?: CustomerFormInitial): FormValues {
  return {
    name: initial?.name ?? "",
    kana: initial?.kana ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    postalCode: initial?.postalCode ?? "",
    address: initial?.address ?? "",
    channel: initial?.channel ?? "EVENT",
    sourceEventId: initial?.sourceEventId ?? "",
    note: initial?.note ?? "",
  };
}

export function CustomerForm({ mode, onSubmitAction, redirectTo }: CustomerFormProps) {
  const router = useRouter();
  const t = labels.customer;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(FormSchema) as any,
    defaultValues: toFormValues(mode.kind === "edit" ? mode.initial : undefined),
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    const blank = (s: string | undefined) => (s?.trim() ? s.trim() : undefined);

    startTransition(async () => {
      try {
        const result = await onSubmitAction({
          ...(mode.kind === "edit" ? { id: mode.id } : {}),
          name: values.name.trim(),
          kana: blank(values.kana),
          phone: values.phone.trim(),
          email: blank(values.email),
          postalCode: blank(values.postalCode),
          address: blank(values.address),
          channel: values.channel,
          sourceEventId: blank(values.sourceEventId),
          note: blank(values.note),
        });

        if (result.duplicatePhoneWarning) {
          toast.warning(t.feedback.duplicatePhone);
        }

        if (mode.kind === "create") {
          toast.success(c.saved);
          router.push(redirectTo ?? `/customers/${result.id}`);
        } else {
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
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-2xl space-y-6" noValidate>
        {/* 基本情報 */}
        <section className="bg-white border border-cloud-gray rounded-lg p-8 space-y-4">
          <h2 className="text-lg font-medium text-carbon-dark border-b border-cloud-gray pb-2 mb-4">{t.sections.basic}</h2>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.name} <span className="text-destructive">*</span>
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
            name="kana"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.kana}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* 連絡先 */}
        <section className="bg-white border border-cloud-gray rounded-lg p-8 space-y-4">
          <h2 className="text-lg font-medium text-carbon-dark border-b border-cloud-gray pb-2 mb-4">{t.sections.contact}</h2>
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.phone} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input type="tel" autoComplete="tel" aria-required="true" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.email}</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* 住所 */}
        <section className="bg-white border border-cloud-gray rounded-lg p-8 space-y-4">
          <h2 className="text-lg font-medium text-carbon-dark border-b border-cloud-gray pb-2 mb-4">{t.sections.address}</h2>
          <FormField
            control={form.control}
            name="postalCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.postalCode}</FormLabel>
                <FormControl>
                  <Input autoComplete="postal-code" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.address}</FormLabel>
                <FormControl>
                  <Input autoComplete="street-address" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* 獲得チャネル */}
        <section className="bg-white border border-cloud-gray rounded-lg p-8 space-y-4">
          <h2 className="text-lg font-medium text-carbon-dark border-b border-cloud-gray pb-2 mb-4">{t.sections.acquisition}</h2>
          <FormField
            control={form.control}
            name="channel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.channel} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="border border-cloud-gray bg-white text-carbon-dark rounded-sm px-3 py-2 text-sm h-10 w-full focus:outline-none focus:ring-2 focus:ring-electric-blue/20 focus:border-electric-blue transition-colors"
                  >
                    <option value="EVENT">{t.channels.EVENT}</option>
                    <option value="WALK_IN">{t.channels.WALK_IN}</option>
                    <option value="TELE">{t.channels.TELE}</option>
                    <option value="REFERRAL">{t.channels.REFERRAL}</option>
                    <option value="OTHER">{t.channels.OTHER}</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sourceEventId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.sourceEventId}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* 備考 */}
        <section className="bg-white border border-cloud-gray rounded-lg p-8 space-y-4">
          <h2 className="text-lg font-medium text-carbon-dark border-b border-cloud-gray pb-2 mb-4">{t.sections.note}</h2>
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.note}</FormLabel>
                <FormControl>
                  <textarea
                    rows={4}
                    className="border border-cloud-gray bg-white text-carbon-dark placeholder:text-silver-fog rounded-sm px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-electric-blue/20 focus:border-electric-blue transition-colors"
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
