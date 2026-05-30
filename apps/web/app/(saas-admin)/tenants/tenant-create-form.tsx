"use client";

// S-015 — 卸業者テナント新規作成フォーム (T-02-08 / F-004).
//
// `CreateTenantSchema` を共通スキーマとして使用。SAAS_ADMIN 専用画面なので
// 権限チェックはサーバー側 Server Action と RSC ガードに任せ、ここは入力検証と
// 送信のみを担う。

import { zodResolver } from "@hookform/resolvers/zod";
import { CreateTenantSchema, type CreateTenantInput } from "@solar/contracts/schemas/tenant";
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

import { createTenantAction } from "./actions";

export function TenantCreateForm() {
  const router = useRouter();
  const t = labels.saasAdminTenant;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<CreateTenantInput>({
    // CreateTenantSchema には `type` の default が含まれ resolver の型が緩む
    // ため、any キャストで RHF 側の型を保つ。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(CreateTenantSchema) as any,
    defaultValues: {
      name: "",
      type: "WHOLESALER",
      plan: "SMALL",
      adminEmail: "",
      adminName: "",
    },
  });

  function onSubmit(values: CreateTenantInput) {
    setServerError(null);
    startTransition(async () => {
      try {
        const result = await createTenantAction(values);
        toast.success(c.saved);
        router.push(`/tenants/${result.tenantId}`);
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" noValidate>
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
            name="plan"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.plan} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    <option value="SMALL">{t.plans.SMALL}</option>
                    <option value="MEDIUM">{t.plans.MEDIUM}</option>
                    <option value="LARGE">{t.plans.LARGE}</option>
                    <option value="PILOT">{t.plans.PILOT}</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.admin}</h2>
          <FormField
            control={form.control}
            name="adminEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.adminEmail} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" aria-required="true" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="adminName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.adminName} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input autoComplete="name" aria-required="true" {...field} />
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
            {pending ? t.actions.creating : t.actions.createSubmit}
          </Button>
        </div>
      </form>
    </Form>
  );
}
