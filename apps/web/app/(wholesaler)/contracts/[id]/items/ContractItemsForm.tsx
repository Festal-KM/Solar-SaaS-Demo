"use client";

// ContractItemsForm — client component for S-044 contract item management.
//
// Manages a local list of (productId, qty) rows. On submit the entire list is
// sent to replaceContractItemsAction (full-replace, not patch).
// snapshotPurchasePrice is displayed only in the wholesaler context; the DTO
// layer strips it for dealer views — this component always receives the full
// wholesaler DTO so it always shows all columns.

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";
import type { ContractItemForWholesalerDto } from "@solar/contracts";

import { replaceContractItemsAction } from "./actions";

interface ProductOption {
  id: string;
  name: string;
  maker: string;
  modelNo: string | null;
  unit: string;
  dealerPrice: string;
  listPrice: string;
}

interface Props {
  contractId: string;
  contractDate: string;
  products: ProductOption[];
  initialItems: ContractItemForWholesalerDto[];
  isEditable: boolean;
}

interface DraftRow {
  productId: string;
  qty: number;
}

export function ContractItemsForm({
  contractId,
  products,
  initialItems,
  isEditable,
}: Props) {
  const t = labels.contractItem;
  const c = labels.common;

  const [isPending, startTransition] = useTransition();
  const [draftRows, setDraftRows] = useState<DraftRow[]>(() =>
    initialItems.map((item) => ({
      productId: item.productId,
      qty: Number(item.qty),
    })),
  );
  const [newProductId, setNewProductId] = useState("");
  const [newQty, setNewQty] = useState(1);

  const productMap = new Map(products.map((p) => [p.id, p]));

  function addRow() {
    if (!newProductId) return;
    setDraftRows((prev) => [...prev, { productId: newProductId, qty: newQty }]);
    setNewProductId("");
    setNewQty(1);
  }

  function removeRow(index: number) {
    setDraftRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateQty(index: number, qty: number) {
    setDraftRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, qty: Math.max(1, qty) } : r)),
    );
  }

  function handleSubmit() {
    if (draftRows.length === 0) {
      toast.error(t.errors.itemsRequired);
      return;
    }
    startTransition(async () => {
      try {
        await replaceContractItemsAction({ contractId, items: draftRows });
        toast.success(t.feedback.saved);
      } catch (err) {
        const msg = err instanceof Error ? err.message : c.unknownError;
        toast.error(msg);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Existing / draft items table */}
      <div className="border-border rounded-md border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">{t.columns.productName}</th>
                <th className="px-3 py-2 text-left font-medium">{t.columns.maker}</th>
                <th className="px-3 py-2 text-right font-medium">{t.columns.qty}</th>
                <th className="px-3 py-2 text-left font-medium">{t.columns.unit}</th>
                <th className="px-3 py-2 text-right font-medium">{t.columns.purchasePrice}</th>
                <th className="px-3 py-2 text-right font-medium">{t.columns.dealerPrice}</th>
                <th className="px-3 py-2 text-right font-medium">{t.columns.listPrice}</th>
                <th className="px-3 py-2 text-right font-medium">{t.columns.subtotal}</th>
                {isEditable && (
                  <th className="px-3 py-2 text-center font-medium">{c.actions}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {draftRows.length === 0 && (
                <tr>
                  <td
                    colSpan={isEditable ? 9 : 8}
                    className="px-3 py-4 text-center text-muted-foreground"
                  >
                    {t.empty}
                  </td>
                </tr>
              )}
              {draftRows.map((row, idx) => {
                const product = productMap.get(row.productId);
                const listPrice = product ? Number(product.listPrice) : 0;
                const subtotal = (row.qty * listPrice).toLocaleString("ja-JP");
                return (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="px-3 py-2">{product?.name ?? row.productId}</td>
                    <td className="px-3 py-2">{product?.maker ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {isEditable ? (
                        <input
                          type="number"
                          min={1}
                          value={row.qty}
                          onChange={(e) => updateQty(idx, Number(e.target.value))}
                          className="w-16 rounded border px-1 py-0.5 text-right text-sm"
                        />
                      ) : (
                        row.qty
                      )}
                    </td>
                    <td className="px-3 py-2">{product?.unit ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {t.purchasePriceHidden}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {product
                        ? Number(product.dealerPrice).toLocaleString("ja-JP")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {product ? Number(product.listPrice).toLocaleString("ja-JP") : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{subtotal}</td>
                    {isEditable && (
                      <td className="px-3 py-2 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeRow(idx)}
                          className="text-destructive hover:text-destructive"
                        >
                          {c.delete}
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add row form */}
      {isEditable && (
        <div className="border-border rounded-md border p-4 space-y-3">
          <h3 className="font-medium text-sm">{t.addRow}</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-48 space-y-1">
              <label className="text-xs text-muted-foreground">{t.fields.product}</label>
              <select
                value={newProductId}
                onChange={(e) => setNewProductId(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-sm"
              >
                <option value="">{t.selectProduct}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.maker} {p.name}
                    {p.modelNo ? ` (${p.modelNo})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24 space-y-1">
              <label className="text-xs text-muted-foreground">{t.fields.qty}</label>
              <input
                type="number"
                min={1}
                value={newQty}
                onChange={(e) => setNewQty(Math.max(1, Number(e.target.value)))}
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={!newProductId}
            >
              {t.actions.addRow}
            </Button>
          </div>
        </div>
      )}

      {/* Submit */}
      {isEditable && (
        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={isPending || draftRows.length === 0}>
            {isPending ? t.actions.saving : t.actions.save}
          </Button>
        </div>
      )}
    </div>
  );
}
