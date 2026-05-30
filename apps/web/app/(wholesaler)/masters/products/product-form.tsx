"use client";

// Shared client form for S-042 「新規作成」と「基本情報編集」.
//
// Two modes:
//   - create : full schema (all price fields + dates required)
//   - edit   : only the non-price metadata (name / maker / modelNo / note /
//              isActive). Price changes go through `/masters/products/[id]/revise`
//              so the audit history stays append-only.
//
// Client-side validation uses a permissive form schema; the canonical
// `ProductInputSchema` / `ProductUpdateSchema` re-run on the server so the
// user sees the same errors on submit as during typing.

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ProductInputSchema,
  ProductUpdateSchema,
  type ProductCategory,
  type ProductInput,
  type ProductUpdate,
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

import { createProductAction, retireProductAction, updateProductAction } from "./actions";

type CategoryValue = ProductCategory;

interface CreateInitial {
  category: CategoryValue;
  maker: string;
  name: string;
  modelNo: string;
  capacity: string;
  unit: string;
  purchasePrice: string;
  dealerPrice: string;
  listPrice: string;
  effectiveFrom: string;
  effectiveTo: string;
  note: string;
}

type Mode =
  | { kind: "create" }
  | {
      kind: "edit";
      id: string;
      isActive: boolean;
      initial: {
        category: CategoryValue;
        maker: string;
        name: string;
        modelNo: string;
        note: string;
      };
    };

const CreateFormSchema = z
  .object({
    category: z.enum(["PANEL", "BATTERY", "POWER_CONDITIONER", "MOUNT", "OTHER_PART", "SET"]),
    maker: z.string().trim().min(1, "メーカーを入力してください").max(255),
    name: z.string().trim().min(1, "商品名を入力してください").max(255),
    modelNo: z.string().max(255).optional().default(""),
    capacity: z
      .string()
      .optional()
      .default("")
      .refine((v) => v === "" || /^\d+(\.\d+)?$/.test(v), "数値を入力してください"),
    unit: z.string().trim().min(1, "単位を入力してください").max(32),
    purchasePrice: z.string().refine((v) => /^\d+(\.\d+)?$/.test(v), "価格を入力してください"),
    dealerPrice: z.string().refine((v) => /^\d+(\.\d+)?$/.test(v), "価格を入力してください"),
    listPrice: z.string().refine((v) => /^\d+(\.\d+)?$/.test(v), "価格を入力してください"),
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

type CreateFormValues = z.input<typeof CreateFormSchema>;

const EditFormSchema = z.object({
  category: z.enum(["PANEL", "BATTERY", "POWER_CONDITIONER", "MOUNT", "OTHER_PART", "SET"]),
  maker: z.string().trim().min(1, "メーカーを入力してください").max(255),
  name: z.string().trim().min(1, "商品名を入力してください").max(255),
  modelNo: z.string().max(255).optional().default(""),
  note: z.string().max(2000).optional().default(""),
});
type EditFormValues = z.input<typeof EditFormSchema>;

function toCreatePayload(v: CreateFormValues): ProductInput {
  const blank = (s: string) => (s.trim().length === 0 ? undefined : s.trim());
  return ProductInputSchema.parse({
    category: v.category,
    maker: v.maker.trim(),
    name: v.name.trim(),
    modelNo: blank(v.modelNo ?? ""),
    capacity: blank(v.capacity ?? ""),
    unit: v.unit.trim(),
    purchasePrice: v.purchasePrice,
    dealerPrice: v.dealerPrice,
    listPrice: v.listPrice,
    effectiveFrom: new Date(v.effectiveFrom),
    effectiveTo: v.effectiveTo && v.effectiveTo !== "" ? new Date(v.effectiveTo) : undefined,
    note: blank(v.note ?? ""),
  });
}

function toEditPayload(v: EditFormValues): ProductUpdate {
  const blank = (s: string) => (s.trim().length === 0 ? undefined : s.trim());
  return ProductUpdateSchema.parse({
    maker: v.maker.trim(),
    name: v.name.trim(),
    modelNo: blank(v.modelNo ?? ""),
    note: blank(v.note ?? ""),
  });
}

export interface ProductFormProps {
  mode: Mode;
  initial?: CreateInitial;
}

export function ProductForm({ mode, initial }: ProductFormProps) {
  const router = useRouter();
  const t = labels.product;
  const c = labels.common;

  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [retiring, startRetire] = useTransition();

  if (mode.kind === "create") {
    return (
      <CreateProductFormInner
        initial={initial}
        labels={{ t, c }}
        pending={pending}
        startTransition={startTransition}
        serverError={serverError}
        setServerError={setServerError}
        onCreated={(id) => router.push(`/masters/products/${id}`)}
      />
    );
  }

  return (
    <EditProductFormInner
      mode={mode}
      labels={{ t, c }}
      pending={pending}
      startTransition={startTransition}
      retiring={retiring}
      startRetire={startRetire}
      serverError={serverError}
      setServerError={setServerError}
      onSaved={() => router.refresh()}
    />
  );
}

interface InnerLabels {
  t: typeof labels.product;
  c: typeof labels.common;
}

function CreateProductFormInner({
  initial,
  labels: { t, c },
  pending,
  startTransition,
  serverError,
  setServerError,
  onCreated,
}: {
  initial?: CreateInitial;
  labels: InnerLabels;
  pending: boolean;
  startTransition: (cb: () => void | Promise<void>) => void;
  serverError: string | null;
  setServerError: (m: string | null) => void;
  onCreated: (id: string) => void;
}) {
  const form = useForm<CreateFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(CreateFormSchema) as any,
    defaultValues: {
      category: initial?.category ?? "PANEL",
      maker: initial?.maker ?? "",
      name: initial?.name ?? "",
      modelNo: initial?.modelNo ?? "",
      capacity: initial?.capacity ?? "",
      unit: initial?.unit ?? "枚",
      purchasePrice: initial?.purchasePrice ?? "",
      dealerPrice: initial?.dealerPrice ?? "",
      listPrice: initial?.listPrice ?? "",
      effectiveFrom: initial?.effectiveFrom ?? new Date().toISOString().slice(0, 10),
      effectiveTo: initial?.effectiveTo ?? "",
      note: initial?.note ?? "",
    },
  });

  function onSubmit(values: CreateFormValues) {
    setServerError(null);
    let payload: ProductInput;
    try {
      payload = toCreatePayload(values);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : c.unknownError;
      setServerError(message);
      return;
    }
    startTransition(async () => {
      try {
        const result = await createProductAction(payload);
        toast.success(c.saved);
        onCreated(result.id);
      } catch (err) {
        setServerError(err instanceof Error && err.message ? err.message : c.unknownError);
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
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.category} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {(
                      [
                        "PANEL",
                        "BATTERY",
                        "POWER_CONDITIONER",
                        "MOUNT",
                        "OTHER_PART",
                        "SET",
                      ] as const
                    ).map((k) => (
                      <option key={k} value={k}>
                        {t.categories[k]}
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
            name="maker"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.maker} <span className="text-destructive">*</span>
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
            name="modelNo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.modelNo}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.specs}</h2>
          <FormField
            control={form.control}
            name="capacity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.capacity}</FormLabel>
                <FormControl>
                  <Input type="text" inputMode="decimal" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="unit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.unit} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

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

        <div className="flex items-center justify-end gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? c.saving : t.actions.createSubmit}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function EditProductFormInner({
  mode,
  labels: { t, c },
  pending,
  startTransition,
  retiring,
  startRetire,
  serverError,
  setServerError,
  onSaved,
}: {
  mode: Extract<Mode, { kind: "edit" }>;
  labels: InnerLabels;
  pending: boolean;
  startTransition: (cb: () => void | Promise<void>) => void;
  retiring: boolean;
  startRetire: (cb: () => void | Promise<void>) => void;
  serverError: string | null;
  setServerError: (m: string | null) => void;
  onSaved: () => void;
}) {
  const form = useForm<EditFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(EditFormSchema) as any,
    defaultValues: {
      category: mode.initial.category,
      maker: mode.initial.maker,
      name: mode.initial.name,
      modelNo: mode.initial.modelNo,
      note: mode.initial.note,
    },
  });

  function onSubmit(values: EditFormValues) {
    setServerError(null);
    let payload: ProductUpdate;
    try {
      payload = toEditPayload(values);
    } catch (err) {
      setServerError(err instanceof Error && err.message ? err.message : c.unknownError);
      return;
    }
    startTransition(async () => {
      try {
        await updateProductAction({ id: mode.id, patch: payload });
        toast.success(c.saved);
        onSaved();
      } catch (err) {
        setServerError(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  function onRetire() {
    if (!window.confirm(t.actions.retireConfirm)) return;
    setServerError(null);
    startRetire(async () => {
      try {
        await retireProductAction({ id: mode.id });
        toast.success(c.disabled);
        onSaved();
      } catch (err) {
        setServerError(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" noValidate>
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.basic}</h2>
          {/* Category is fixed once a row exists — revisions inherit the
              parent's category — so we render it as read-only metadata. */}
          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.category}</FormLabel>
                <FormControl>
                  <Input readOnly value={t.categories[field.value as CategoryValue]} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="maker"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t.fields.maker} <span className="text-destructive">*</span>
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
            name="modelNo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.fields.modelNo}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
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

        <div className="flex items-center justify-between">
          {mode.isActive ? (
            <Button type="button" variant="destructive" disabled={retiring} onClick={onRetire}>
              {retiring ? c.disabling : t.actions.retire}
            </Button>
          ) : (
            <span className="text-muted-foreground text-sm">{c.inactive}</span>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? c.saving : t.actions.updateSubmit}
          </Button>
        </div>
      </form>
    </Form>
  );
}
