"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AreaInputSchema, type AreaInput } from "@solar/contracts/schemas/area";
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

import { createAreaAction, disableAreaAction, updateAreaAction } from "./actions";

// Shared form for area create + edit (エリアマスタ). installer-form と同じ形:
// client-side schema は許容的 ("" を受ける)、`toPayload` で空白を正規化してから
// canonical な `AreaInputSchema` に通す。

type Mode =
  | { kind: "create" }
  | {
      kind: "edit";
      id: string;
      initial: AreaInput & { isActive: boolean };
    };

interface FormValues {
  name: string;
}

const FormValuesSchema = z.object({
  name: z.string().trim().min(1, "名称を入力してください").max(255),
});

function toFormValues(initial?: AreaInput): FormValues {
  return {
    name: initial?.name ?? "",
  };
}

function toPayload(v: FormValues): AreaInput {
  return AreaInputSchema.parse({
    name: v.name.trim(),
  });
}

export interface AreaFormProps {
  mode: Mode;
}

export function AreaForm({ mode }: AreaFormProps) {
  const router = useRouter();
  const t = labels.areaMaster;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [disabling, startDisabling] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormValuesSchema),
    defaultValues: toFormValues(mode.kind === "edit" ? mode.initial : undefined),
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    let payload: AreaInput;
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
          await createAreaAction(payload);
          toast.success(c.saved);
          router.push("/masters/areas");
        } else {
          await updateAreaAction({ id: mode.id, patch: payload });
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
        await disableAreaAction({ id: mode.id });
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
