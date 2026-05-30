import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { getProduct, getProductHistory } from "../data";
import { ProductForm } from "../product-form";

// S-043 — 商品マスタ詳細・履歴.
//
// Lays out: 基本情報 (editable via `ProductForm` edit mode), 現在の価格
// (read-only — must go through 「価格改定」 button to mutate), 価格改定履歴.

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;
  const row = await getProduct(id);
  if (!row) {
    notFound();
  }
  const history = await getProductHistory(id);

  const t = labels.product;
  const c = labels.common;
  const bc = labels.breadcrumb.items;

  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: bc.masters, href: "/masters" },
          { label: bc.masterProducts, href: "/masters/products" },
          { label: bc.masterProductDetail },
        ]}
      />
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-4">
          <Button asChild variant="outline" size="sm" className="mt-1 shrink-0">
            <Link href="/masters/products">{c.back}</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t.edit}</h1>
            <p className="text-muted-foreground text-sm">
              {t.categories[row.category]} / {row.maker} / {row.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {row.isActive ? c.active : c.inactive}
          </span>
          {row.isActive ? (
            <Button asChild>
              <Link href={`/masters/products/${row.id}/revise`}>{t.actions.goToRevise}</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <ProductForm
        mode={{
          kind: "edit",
          id: row.id,
          isActive: row.isActive,
          initial: {
            category: row.category,
            maker: row.maker,
            name: row.name,
            modelNo: row.modelNo ?? "",
            note: row.note ?? "",
          },
        }}
      />

      {/* Current price (read-only). Mutating the price MUST flow through
          the revise form so the history table stays the canonical record. */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium">{t.sections.price}</h2>
        <dl className="border-border grid grid-cols-1 gap-x-6 gap-y-2 rounded-md border p-4 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.purchasePrice}</dt>
            <dd className="tabular-nums">{row.purchasePrice}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.dealerPrice}</dt>
            <dd className="tabular-nums">{row.dealerPrice}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.listPrice}</dt>
            <dd className="tabular-nums">{row.listPrice}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.effectiveFrom}</dt>
            <dd>{new Date(row.effectiveFrom).toLocaleDateString("ja-JP")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t.fields.effectiveTo}</dt>
            <dd>{row.effectiveTo ? new Date(row.effectiveTo).toLocaleDateString("ja-JP") : "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">{t.sections.history}</h2>
        {history.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.historyEmpty}</p>
        ) : (
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.fields.changedAt}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.changedBy}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.purchasePrice}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.dealerPrice}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.listPrice}</th>
                  <th className="px-3 py-2 font-medium">{t.fields.reason}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const before = (h.before ?? {}) as Record<string, unknown>;
                  const after = (h.after ?? {}) as Record<string, unknown>;
                  const fmt = (b: unknown, a: unknown) => {
                    const bStr = b == null ? "—" : String(b);
                    const aStr = a == null ? "—" : String(a);
                    return `${bStr} → ${aStr}`;
                  };
                  return (
                    <tr key={h.id} className="border-border border-t">
                      <td className="px-3 py-2 text-xs">
                        {new Date(h.changedAt).toLocaleString("ja-JP")}
                      </td>
                      <td className="px-3 py-2 text-xs">{h.changedBy}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {fmt(before.purchasePrice, after.purchasePrice)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {fmt(before.dealerPrice, after.dealerPrice)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {fmt(before.listPrice, after.listPrice)}
                      </td>
                      <td className="px-3 py-2">
                        {after.reason == null ? "—" : String(after.reason)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
