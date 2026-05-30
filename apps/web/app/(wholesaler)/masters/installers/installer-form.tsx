"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { InstallerInputSchema, type InstallerInput } from "@solar/contracts/schemas/installer";
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

import { createInstallerAction, disableInstallerAction, updateInstallerAction } from "./actions";

// Shared form for installer create + edit (S-052 sub / F-013). Mirrors the
// venue-provider form shape: client-side schema is permissive (uses ""), then
// `toPayload` normalises blanks to undefined before handing to the canonical
// `InstallerInputSchema`.

type Mode =
  | { kind: "create" }
  | {
      kind: "edit";
      id: string;
      initial: InstallerInput & { isActive: boolean };
    };

interface FormValues {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  area: string;
}

const FormValuesSchema = z.object({
  name: z.string().trim().min(1, "名称を入力してください").max(255),
  contactName: z.string().max(255).optional().default(""),
  phone: z.string().max(255).optional().default(""),
  email: z
    .string()
    .max(255)
    .optional()
    .default("")
    .refine((v) => v === "" || /.+@.+\..+/.test(v), "メールアドレスの形式が正しくありません"),
  area: z.string().max(255).optional().default(""),
});

function toFormValues(initial?: InstallerInput): FormValues {
  return {
    name: initial?.name ?? "",
    contactName: initial?.contactName ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    area: initial?.area ?? "",
  };
}

function toPayload(v: FormValues): InstallerInput {
  const blank = (s: string) => (s.trim().length === 0 ? undefined : s.trim());
  return InstallerInputSchema.parse({
    name: v.name.trim(),
    contactName: blank(v.contactName),
    phone: blank(v.phone),
    email: blank(v.email),
    area: blank(v.area),
  });
}

export interface InstallerFormProps {
  mode: Mode;
}

export function InstallerForm({ mode }: InstallerFormProps) {
  const router = useRouter();
  const t = labels.installer;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [disabling, startDisabling] = useTransition();

  const form = useForm<FormValues>({
    // FormValuesSchema uses .default("") which loosens the input type; cast the
    // resolver so we keep the strict FormValues shape on the RHF side.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(FormValuesSchema) as any,
    defaultValues: toFormValues(mode.kind === "edit" ? mode.initial : undefined),
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    let payload: InstallerInput;
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
          const result = await createInstallerAction(payload);
          toast.success(c.saved);
          router.push(`/masters/installers/${result.id}`);
        } else {
          await updateInstallerAction({ id: mode.id, patch: payload });
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
        await disableInstallerAction({ id: mode.id });
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
