"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  VenueProviderInputSchema,
  type VenueProviderInput,
} from "@solar/contracts/schemas/venue-provider";
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

import {
  createVenueProviderAction,
  disableVenueProviderAction,
  updateVenueProviderAction,
} from "./actions";

// Shared form for S-020 (new + edit). Client-side validation uses the same
// Zod schema as the Server Action so the user sees the same error shape both
// before and after submission.

type Mode =
  | { kind: "create" }
  | {
      kind: "edit";
      id: string;
      initial: VenueProviderInput & { isActive: boolean };
    };

interface FormValues {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  postalCode: string;
  address: string;
  area: string;
  contractType: "" | "FIXED" | "PERFORMANCE" | "OTHER";
  fixedFee: string;
  performanceRate: string;
  note: string;
}

// Permissive form-level Zod schema. The canonical `VenueProviderInputSchema`
// expects normalised values (undefined for blanks, parsed decimals); we
// re-create those normalisations in `toPayload` instead of fighting zodResolver
// here. The form-level schema only enforces the rules the user can satisfy
// while typing: name required, email if provided must look like an email, and
// numeric strings if non-empty.
const FormValuesSchema = z
  .object({
    name: z.string().trim().min(1, "名称を入力してください").max(255),
    contactName: z.string().max(255).optional().default(""),
    phone: z.string().max(255).optional().default(""),
    email: z
      .string()
      .max(255)
      .optional()
      .default("")
      .refine((v) => v === "" || /.+@.+\..+/.test(v), "メールアドレスの形式が正しくありません"),
    postalCode: z.string().max(255).optional().default(""),
    address: z.string().trim().min(1, "住所を入力してください").max(255),
    area: z.string().max(255).optional().default(""),
    contractType: z.enum(["", "FIXED", "PERFORMANCE", "OTHER"]),
    fixedFee: z
      .string()
      .optional()
      .default("")
      .refine((v) => v === "" || /^-?\d+(\.\d+)?$/.test(v), "数値を入力してください"),
    performanceRate: z
      .string()
      .optional()
      .default("")
      .refine((v) => v === "" || /^-?\d+(\.\d+)?$/.test(v), "数値を入力してください")
      .refine((v) => {
        if (v === "") return true;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 && n <= 100;
      }, "0〜100 の範囲で入力してください"),
    note: z.string().max(2000).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.contractType === "FIXED" && v.fixedFee.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fixedFee"],
        message: "固定費型では固定費金額が必須です",
      });
    }
    if (v.contractType === "PERFORMANCE" && v.performanceRate.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["performanceRate"],
        message: "成果報酬型では成果報酬率が必須です",
      });
    }
  });

function toFormValues(initial?: VenueProviderInput): FormValues {
  return {
    name: initial?.name ?? "",
    contactName: initial?.contactName ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    postalCode: initial?.postalCode ?? "",
    address: initial?.address ?? "",
    area: initial?.area ?? "",
    contractType: initial?.contractType ?? "",
    fixedFee: initial?.fixedFee ?? "",
    performanceRate: initial?.performanceRate ?? "",
    note: initial?.note ?? "",
  };
}

function toPayload(v: FormValues): VenueProviderInput {
  const blank = (s: string) => (s.trim().length === 0 ? undefined : s.trim());
  return VenueProviderInputSchema.parse({
    name: v.name.trim(),
    contactName: blank(v.contactName),
    phone: blank(v.phone),
    email: blank(v.email),
    postalCode: blank(v.postalCode),
    address: blank(v.address),
    area: blank(v.area),
    contractType: v.contractType === "" ? undefined : v.contractType,
    fixedFee: blank(v.fixedFee),
    performanceRate: blank(v.performanceRate),
    note: blank(v.note),
  });
}

export interface VenueProviderFormProps {
  mode: Mode;
}

export function VenueProviderForm({ mode }: VenueProviderFormProps) {
  const router = useRouter();
  const t = labels.venueProvider;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [disabling, startDisabling] = useTransition();

  const form = useForm<FormValues>({
    // `FormValuesSchema` uses `.default("")` which loosens the input type;
    // we cast the resolver to keep the strict `FormValues` shape on the RHF
    // side without forcing the schema to strip its defaults.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(FormValuesSchema) as any,
    defaultValues: toFormValues(mode.kind === "edit" ? mode.initial : undefined),
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    let payload: VenueProviderInput;
    try {
      payload = toPayload(values);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : c.unknownError;
      setServerError(message);
      return;
    }

    startTransition(async () => {
      try {
        if (mode.kind === "create") {
          const result = await createVenueProviderAction(payload);
          toast.success(c.saved);
          router.push(`/masters/venue-providers/${result.id}`);
        } else {
          await updateVenueProviderAction({ id: mode.id, patch: payload });
          toast.success(c.saved);
          router.refresh();
        }
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  function onDisable() {
    if (mode.kind !== "edit") return;
    if (!window.confirm(t.actions.disableConfirm)) return;
    setServerError(null);
    startDisabling(async () => {
      try {
        await disableVenueProviderAction({ id: mode.id });
        toast.success(c.disabled);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  const submitting = pending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" noValidate>
        {/* 基本情報 */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.basic}</h2>
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
            name="area"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.area}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* 連絡先 */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.contact}</h2>
          <FormField
            control={form.control}
            name="contactName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.contactName}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
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
                <FormLabel>{t.fields.phone}</FormLabel>
                <FormControl>
                  <Input type="tel" autoComplete="tel" {...field} />
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
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.address}</h2>
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
                <FormLabel>
                  {t.fields.address} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input autoComplete="street-address" aria-required="true" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* 契約条件 */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.contract}</h2>
          <FormField
            control={form.control}
            name="contractType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.contractType}</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    <option value="">{c.notSet}</option>
                    <option value="FIXED">{t.contractTypes.FIXED}</option>
                    <option value="PERFORMANCE">{t.contractTypes.PERFORMANCE}</option>
                    <option value="OTHER">{t.contractTypes.OTHER}</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="fixedFee"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.fixedFee}</FormLabel>
                <FormControl>
                  <Input type="text" inputMode="decimal" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="performanceRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.performanceRate}</FormLabel>
                <FormControl>
                  <Input type="text" inputMode="decimal" {...field} />
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
          <div className="flex items-center gap-2">
            {mode.kind === "edit" && mode.initial.isActive ? (
              <Button type="button" variant="destructive" disabled={disabling} onClick={onDisable}>
                {disabling ? c.disabling : t.actions.disable}
              </Button>
            ) : null}
            <Button type="submit" disabled={submitting}>
              {submitting
                ? c.saving
                : mode.kind === "create"
                  ? t.actions.createSubmit
                  : t.actions.updateSubmit}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
