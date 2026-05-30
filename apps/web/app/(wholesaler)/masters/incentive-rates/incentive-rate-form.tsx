"use client";

// Shared client form for incentive-rate create + edit (S-052 sub / F-014).
//
// Two modes:
//   - create : full schema (relationship / targetType / rate / dates)
//   - edit   : rate / effectiveTo / note のみ（targetType と effectiveFrom は
//              IncentiveRateUpdateSchema 側で immutable）
//
// Client-side validation は permissive form schema を使い、Server Action 側で
// canonical な IncentiveRateInputSchema / IncentiveRateUpdateSchema を再パース。

import { zodResolver } from "@hookform/resolvers/zod";
import {
  IncentiveRateInputSchema,
  IncentiveRateUpdateSchema,
  type IncentiveRateInput,
  type IncentiveRateUpdate,
  type IncentiveTargetType,
} from "@solar/contracts/schemas/incentive-rate";
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

import { createIncentiveRateAction, updateIncentiveRateAction } from "./actions";

import type { RelationshipOption } from "./data";

type Mode =
  | { kind: "create"; relationshipOptions: RelationshipOption[] }
  | {
      kind: "edit";
      id: string;
      dealerName: string;
      targetType: IncentiveTargetType;
      effectiveFrom: string; // ISO; display-only
      initial: {
        rate: string;
        effectiveTo: string; // ISO or ""
        note: string;
      };
    };

const CreateFormSchema = z
  .object({
    relationshipId: z.string().trim().min(1, "関係（二次店）を選択してください"),
    targetType: z.enum(["PROJECT_PROFIT", "WHOLESALE_PROFIT", "MANUAL"]),
    rate: z
      .string()
      .min(1, "率（%）を入力してください")
      .refine((v) => /^\d+(\.\d+)?$/.test(v), "数値を入力してください")
      .refine((v) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 && n <= 100;
      }, "0〜100 の範囲で入力してください"),
    effectiveFrom: z.string().min(1, "適用開始日を入力してください"),
    effectiveTo: z.string().optional().default(""),
    note: z.string().max(2000).optional().default(""),
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

type CreateFormValues = z.infer<typeof CreateFormSchema>;

const EditFormSchema = z.object({
  rate: z
    .string()
    .min(1, "率（%）を入力してください")
    .refine((v) => /^\d+(\.\d+)?$/.test(v), "数値を入力してください")
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    }, "0〜100 の範囲で入力してください"),
  effectiveTo: z.string().optional().default(""),
  note: z.string().max(2000).optional().default(""),
});

type EditFormValues = z.infer<typeof EditFormSchema>;

function toCreatePayload(v: CreateFormValues): IncentiveRateInput {
  return IncentiveRateInputSchema.parse({
    relationshipId: v.relationshipId,
    targetType: v.targetType,
    rate: v.rate,
    effectiveFrom: new Date(v.effectiveFrom),
    effectiveTo: v.effectiveTo && v.effectiveTo !== "" ? new Date(v.effectiveTo) : undefined,
    note: v.note && v.note !== "" ? v.note : undefined,
  });
}

function toEditPayload(v: EditFormValues): IncentiveRateUpdate {
  return IncentiveRateUpdateSchema.parse({
    rate: v.rate,
    effectiveTo: v.effectiveTo && v.effectiveTo !== "" ? new Date(v.effectiveTo) : undefined,
    note: v.note && v.note !== "" ? v.note : undefined,
  });
}

export interface IncentiveRateFormProps {
  mode: Mode;
}

export function IncentiveRateForm({ mode }: IncentiveRateFormProps) {
  if (mode.kind === "create") {
    return <CreateForm relationshipOptions={mode.relationshipOptions} />;
  }
  return (
    <EditForm
      id={mode.id}
      dealerName={mode.dealerName}
      targetType={mode.targetType}
      effectiveFrom={mode.effectiveFrom}
      initial={mode.initial}
    />
  );
}

function CreateForm({ relationshipOptions }: { relationshipOptions: RelationshipOption[] }) {
  const router = useRouter();
  const t = labels.incentiveRate;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<CreateFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(CreateFormSchema) as any,
    defaultValues: {
      relationshipId: relationshipOptions[0]?.id ?? "",
      targetType: "PROJECT_PROFIT",
      rate: "",
      effectiveFrom: "",
      effectiveTo: "",
      note: "",
    },
  });

  function onSubmit(values: CreateFormValues) {
    setServerError(null);
    let payload: IncentiveRateInput;
    try {
      payload = toCreatePayload(values);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : c.unknownError;
      setServerError(message);
      return;
    }
    startTransition(async () => {
      try {
        const result = await createIncentiveRateAction(payload);
        toast.success(c.saved);
        router.push(`/masters/incentive-rates/${result.id}`);
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  if (relationshipOptions.length === 0) {
    return (
      <div className="border-border bg-muted/30 rounded-md border p-6 text-sm">
        {t.errors.noActiveRelationships}
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" noValidate>
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.relationship}</h2>
          <FormField
            control={form.control}
            name="relationshipId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.relationship} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {relationshipOptions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.dealerName}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.target}</h2>
          <FormField
            control={form.control}
            name="targetType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.targetType} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {(["PROJECT_PROFIT", "WHOLESALE_PROFIT", "MANUAL"] as const).map((v) => (
                      <option key={v} value={v}>
                        {t.targetTypes[v]}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="rate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.rate} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input type="text" inputMode="decimal" autoComplete="off" {...field} />
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
                  <Input type="date" autoComplete="off" {...field} />
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
                  <Input type="date" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <p className="text-muted-foreground text-xs">{t.notices.overlapClose}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.note}</h2>
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.note}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
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
            {pending ? c.saving : t.actions.createSubmit}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function EditForm(props: {
  id: string;
  dealerName: string;
  targetType: IncentiveTargetType;
  effectiveFrom: string;
  initial: { rate: string; effectiveTo: string; note: string };
}) {
  const router = useRouter();
  const t = labels.incentiveRate;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<EditFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(EditFormSchema) as any,
    defaultValues: {
      rate: props.initial.rate,
      effectiveTo: props.initial.effectiveTo,
      note: props.initial.note,
    },
  });

  function onSubmit(values: EditFormValues) {
    setServerError(null);
    let payload: IncentiveRateUpdate;
    try {
      payload = toEditPayload(values);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : c.unknownError;
      setServerError(message);
      return;
    }
    startTransition(async () => {
      try {
        await updateIncentiveRateAction({ id: props.id, patch: payload });
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" noValidate>
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.relationship}</h2>
          <p className="text-sm">
            <span className="text-muted-foreground">{t.fields.relationship}: </span>
            <span className="font-medium">{props.dealerName}</span>
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">{t.fields.targetType}: </span>
            <span className="font-medium">{t.targetTypes[props.targetType]}</span>
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">{t.fields.effectiveFrom}: </span>
            <span className="font-medium">
              {new Date(props.effectiveFrom).toLocaleDateString("ja-JP")}
            </span>
          </p>
          <p className="text-muted-foreground text-xs">{t.notices.immutableFields}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.target}</h2>
          <FormField
            control={form.control}
            name="rate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.rate} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input type="text" inputMode="decimal" autoComplete="off" {...field} />
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
            name="effectiveTo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.effectiveTo}</FormLabel>
                <FormControl>
                  <Input type="date" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.note}</h2>
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.note}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
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
            {pending ? c.saving : t.actions.updateSubmit}
          </Button>
        </div>
      </form>
    </Form>
  );
}
