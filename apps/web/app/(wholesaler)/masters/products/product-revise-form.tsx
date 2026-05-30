"use client";

// Price-revision form (S-043). Calls `reviseProductRatesAction` which closes
// the previous version's effective period and inserts a new Product row +
// ProductPriceHistory entry in a single transaction.

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ProductReviseRatesSchema,
  type ProductReviseRates,
} from "@solar/contracts/schemas/product";
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

import { reviseProductRatesAction } from "./actions";

export interface ProductReviseFormProps {
  productId: string;
  current: {
    purchasePrice: string;
    dealerPrice: string;
    listPrice: string;
    effectiveFrom: string;
  };
}

const ReviseFormSchema = z
  .object({
    purchasePrice: z.string().refine((v) => /^\d+(\.\d+)?$/.test(v), "価格を入力してください"),
    dealerPrice: z.string().refine((v) => /^\d+(\.\d+)?$/.test(v), "価格を入力してください"),
    listPrice: z.string().refine((v) => /^\d+(\.\d+)?$/.test(v), "価格を入力してください"),
    effectiveFrom: z.string().min(1, "適用開始日を入力してください"),
    effectiveTo: z.string().optional().default(""),
    reason: z.string().max(500).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.effectiveTo && v.effectiveTo !== "") {
      if (new Date(v.effectiveFrom).getTime() >= new Date(v.effectiveTo).getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["effectiveTo"],
          message: "適用終了日は適用開始日より後にしてください",
        });
      }
    }
  });
type ReviseFormValues = z.input<typeof ReviseFormSchema>;

function toPayload(v: ReviseFormValues): ProductReviseRates {
  const blank = (s: string) => (s.trim().length === 0 ? undefined : s.trim());
  return ProductReviseRatesSchema.parse({
    purchasePrice: v.purchasePrice,
    dealerPrice: v.dealerPrice,
    listPrice: v.listPrice,
    effectiveFrom: new Date(v.effectiveFrom),
    effectiveTo: v.effectiveTo && v.effectiveTo !== "" ? new Date(v.effectiveTo) : undefined,
    reason: blank(v.reason ?? ""),
  });
}

export function ProductReviseForm({ productId, current }: ProductReviseFormProps) {
  const router = useRouter();
  const t = labels.product;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<ReviseFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(ReviseFormSchema) as any,
    defaultValues: {
      purchasePrice: current.purchasePrice,
      dealerPrice: current.dealerPrice,
      listPrice: current.listPrice,
      // Default the new effective date to today so the most common path
      // (今日付けで改定) is one click away.
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveTo: "",
      reason: "",
    },
  });

  function onSubmit(values: ReviseFormValues) {
    setServerError(null);
    let payload: ProductReviseRates;
    try {
      payload = toPayload(values);
    } catch (err) {
      setServerError(err instanceof Error && err.message ? err.message : c.unknownError);
      return;
    }
    startTransition(async () => {
      try {
        const result = await reviseProductRatesAction({ id: productId, patch: payload });
        toast.success(c.saved);
        router.push(`/masters/products/${result.newId}`);
      } catch (err) {
        setServerError(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" noValidate>
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.price}</h2>
          <FormField
            control={form.control}
            name="purchasePrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.purchasePrice} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input type="text" inputMode="decimal" aria-required="true" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="dealerPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.dealerPrice} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input type="text" inputMode="decimal" aria-required="true" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="listPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.listPrice} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input type="text" inputMode="decimal" aria-required="true" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.effective}</h2>
          <FormField
            control={form.control}
            name="effectiveFrom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.effectiveFrom} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input type="date" aria-required="true" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="effectiveTo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.effectiveTo}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.fields.reason}</FormLabel>
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

        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {c.back}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? c.saving : t.actions.reviseSubmit}
          </Button>
        </div>
      </form>
    </Form>
  );
}
