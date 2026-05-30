"use client";

// S-016 詳細 — 新プラン適用フォーム (T-02-09 / F-005).
//
// `UpdatePlanSchema` を共通スキーマとして使う。SAAS_ADMIN 専用画面なので
// 権限チェックはサーバー側 Server Action と RSC ガードに任せ、ここは入力検証と
// 送信のみ。

import { zodResolver } from "@hookform/resolvers/zod";
import { UpdatePlanSchema, type UpdatePlanInput } from "@solar/contracts/schemas/plan";
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

import { updatePlanAction } from "./actions";

import type { TenantPlanValue } from "@solar/contracts";

export interface PlanUpdateFormProps {
  tenantId: string;
  currentPlan: TenantPlanValue | null;
}

export function PlanUpdateForm({ tenantId, currentPlan }: PlanUpdateFormProps) {
  const router = useRouter();
  const t = labels.saasAdminPlan;
  const tt = labels.saasAdminTenant;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<UpdatePlanInput>({
    // UpdatePlanSchema は z.transform を含み resolver の型が緩むため
    // any キャストで RHF 側の型を保つ（tenant-create-form と同じ運用）。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(UpdatePlanSchema) as any,
    defaultValues: {
      tenantId,
      plan:
        currentPlan && currentPlan !== "PILOT" && currentPlan !== "LARGE"
          ? currentPlan
          : currentPlan === "LARGE"
            ? "LARGE"
            : "SMALL",
      note: "",
    },
  });

  function onSubmit(values: UpdatePlanInput) {
    setServerError(null);
    startTransition(async () => {
      try {
        const result = await updatePlanAction(values);
        if (result.changed) {
          toast.success(c.saved);
        } else {
          toast.success(t.notices.noOp);
        }
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <input type="hidden" {...form.register("tenantId")} value={tenantId} />

        <FormField
          control={form.control}
          name="plan"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t.fields.newPlan} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  aria-label={t.fields.newPlan}
                >
                  <option value="SMALL">{tt.plans.SMALL}</option>
                  <option value="MEDIUM">{tt.plans.MEDIUM}</option>
                  <option value="LARGE">{tt.plans.LARGE}</option>
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="effectiveFrom"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t.fields.effectiveFrom}</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  value={
                    typeof field.value === "string"
                      ? field.value
                      : field.value instanceof Date
                        ? field.value.toISOString().slice(0, 10)
                        : ""
                  }
                  onChange={(e) => field.onChange(e.target.value || undefined)}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
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
              <FormLabel>{t.fields.note}</FormLabel>
              <FormControl>
                <textarea
                  {...field}
                  value={field.value ?? ""}
                  rows={3}
                  className="border-input bg-background ring-offset-background focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
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

        <div className="flex items-center justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? t.actions.applying : t.actions.apply}
          </Button>
        </div>
      </form>
    </Form>
  );
}
