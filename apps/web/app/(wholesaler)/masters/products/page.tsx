import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { listProducts } from "./data";

import type { ProductCategory } from "@solar/contracts";

// S-042 — 商品マスタ一覧 (F-012, docs/04 §1.3).
//
// Plain `<table>` with category + maker filters. Submit as a GET form so the
// filters survive page refreshes / sharing. RSC re-renders with the filter
// applied via `listProducts`.

export const dynamic = "force-dynamic";

const ALL_CATEGORIES: ProductCategory[] = [
  "PANEL",
  "BATTERY",
  "POWER_CONDITIONER",
  "MOUNT",
  "OTHER_PART",
  "SET",
];

function asCategory(v: string | undefined): ProductCategory | undefined {
  if (!v) return undefined;
  return ALL_CATEGORIES.includes(v as ProductCategory) ? (v as ProductCategory) : undefined;
}

interface PageProps {
  searchParams: Promise<{ category?: string; maker?: string }>;
}

export default async function ProductsListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const category = asCategory(params.category);
  const maker = params.maker?.trim() ?? "";

  const rows = await listProducts({
    ...(category ? { category } : {}),
    ...(maker ? { maker } : {}),
  });

  const t = labels.product;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground text-sm">{t.listTitle}</p>
        </div>
        <Button asChild>
          <Link href="/masters/products/new">{t.new}</Link>
        </Button>
      </div>

      <form method="get" className="flex max-w-3xl items-center gap-2">
        <select
          name="category"
          defaultValue={category ?? ""}
          aria-label={t.filterByCategory}
          className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <option value="">{t.allCategories}</option>
          {ALL_CATEGORIES.map((k) => (
            <option key={k} value={k}>
              {t.categories[k]}
            </option>
          ))}
        </select>
        <Input
          type="search"
          name="maker"
          defaultValue={maker}
          placeholder={t.searchByMaker}
          aria-label={t.searchByMaker}
        />
        <Button type="submit" variant="outline">
          {c.search}
        </Button>
      </form>

      {rows.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
          <Button asChild className="mt-4">
            <Link href="/masters/products/new">{t.new}</Link>
          </Button>
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t.fields.category}</th>
                <th className="px-3 py-2 font-medium">{t.fields.maker}</th>
                <th className="px-3 py-2 font-medium">{t.fields.name}</th>
                <th className="px-3 py-2 font-medium">{t.fields.modelNo}</th>
                <th className="px-3 py-2 font-medium">{t.fields.unit}</th>
                <th className="px-3 py-2 text-right font-medium">{t.fields.dealerPrice}</th>
                <th className="px-3 py-2 text-right font-medium">{t.fields.listPrice}</th>
                <th className="px-3 py-2 font-medium">{t.fields.effectiveFrom}</th>
                <th className="px-3 py-2 font-medium">{t.fields.isActive}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-border border-t">
                  <td className="px-3 py-2">{t.categories[r.category]}</td>
                  <td className="px-3 py-2">{r.maker}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/masters/products/${r.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.modelNo ?? "—"}</td>
                  <td className="px-3 py-2">{r.unit}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.dealerPrice}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.listPrice}</td>
                  <td className="text-muted-foreground px-3 py-2 text-xs">
                    {new Date(r.effectiveFrom).toLocaleDateString("ja-JP")}
                  </td>
                  <td className="px-3 py-2">{r.isActive ? c.active : c.inactive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
