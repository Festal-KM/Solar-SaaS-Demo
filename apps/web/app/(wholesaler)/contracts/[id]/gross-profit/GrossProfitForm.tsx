"use client";

// GrossProfitForm — client component for S-045 gross-profit recalc + adjust.
//
// Two panels:
//   1. Recalc — salesPrice / constructionFee / otherCost / discount /
//      incentiveTargetType + optional manualValue → recalcGrossProfitAction
//   2. Summary — read-only display of the last computed GrossProfit row
//   3. Adjust — manualValue + reason → adjustGrossProfitAction

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import {
  recalcGrossProfitAction,
  adjustGrossProfitAction,
  type GrossProfitResult,
} from "./actions";

interface GrossProfitData {
  id: string;
  salesPrice: string;
  purchaseTotal: string;
  dealerTotal: string;
  constructionFee: string;
  otherCost: string;
  discount: string;
  projectProfit: string;
  wholesaleProfit: string;
  profitRate: string;
  incentiveTargetProfit: string;
  incentiveTargetType: string;
  manualAdjustedAt: string | null;
  manualAdjustmentReason: string | null;
}

interface Props {
  contractId: string;
  grossProfit: GrossProfitData | null;
  hasItems: boolean;
  contractAmount: string;
}

function formatAmount(v: string) {
  return Number(v).toLocaleString("ja-JP");
}

function formatRate(v: string) {
  return (Number(v) * 100).toFixed(2) + "%";
}

export function GrossProfitForm({ contractId, grossProfit: initial, hasItems, contractAmount }: Props) {
  const t = labels.grossProfit;
  const c = labels.common;

  const [gp, setGp] = useState<GrossProfitData | null>(initial);

  // Recalc form state
  const [salesPrice, setSalesPrice] = useState(initial?.salesPrice ?? contractAmount);
  const [constructionFee, setConstructionFee] = useState(initial?.constructionFee ?? "0");
  const [otherCost, setOtherCost] = useState(initial?.otherCost ?? "0");
  const [discount, setDiscount] = useState(initial?.discount ?? "0");
  const [targetType, setTargetType] = useState<"PROJECT_PROFIT" | "WHOLESALE_PROFIT" | "MANUAL">(
    (initial?.incentiveTargetType as "PROJECT_PROFIT" | "WHOLESALE_PROFIT" | "MANUAL") ??
      "PROJECT_PROFIT",
  );
  const [manualValue, setManualValue] = useState(initial?.incentiveTargetProfit ?? "0");

  // Adjust form state
  const [adjustValue, setAdjustValue] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const [recalcPending, startRecalc] = useTransition();
  const [adjustPending, startAdjust] = useTransition();

  function handleRecalc() {
    if (!salesPrice) {
      toast.error(t.errors.salesPriceRequired);
      return;
    }
    startRecalc(async () => {
      try {
        const result = await recalcGrossProfitAction({
          contractId,
          salesPrice,
          constructionFee,
          otherCost,
          discount,
          incentiveTargetType: targetType,
          manualValue: targetType === "MANUAL" ? manualValue : undefined,
        });
        setGp(result as GrossProfitData);
        toast.success(t.feedback.recalcDone);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : c.unknownError);
      }
    });
  }

  function handleAdjust() {
    if (!adjustValue) {
      toast.error(t.errors.manualValueRequired);
      return;
    }
    if (!adjustReason.trim()) {
      toast.error(t.errors.reasonRequired);
      return;
    }
    startAdjust(async () => {
      try {
        const result = await adjustGrossProfitAction({
          contractId,
          manualValue: adjustValue,
          reason: adjustReason,
        });
        setGp(result as GrossProfitData);
        setAdjustValue("");
        setAdjustReason("");
        toast.success(t.feedback.adjustDone);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------------ */}
      {/* Recalc panel                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">{t.sections.recalc}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span>{t.fields.salesPrice}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={salesPrice}
              onChange={(e) => setSalesPrice(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
              disabled={!hasItems}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>{t.fields.constructionFee}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={constructionFee}
              onChange={(e) => setConstructionFee(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
              disabled={!hasItems}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>{t.fields.otherCost}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={otherCost}
              onChange={(e) => setOtherCost(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
              disabled={!hasItems}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>{t.fields.discount}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
              disabled={!hasItems}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>{t.fields.incentiveTargetType}</span>
            <select
              value={targetType}
              onChange={(e) =>
                setTargetType(e.target.value as "PROJECT_PROFIT" | "WHOLESALE_PROFIT" | "MANUAL")
              }
              className="border rounded px-3 py-2 text-sm bg-background"
              disabled={!hasItems}
            >
              {(["PROJECT_PROFIT", "WHOLESALE_PROFIT", "MANUAL"] as const).map((k) => (
                <option key={k} value={k}>
                  {t.incentiveTargetTypes[k]}
                </option>
              ))}
            </select>
          </label>

          {targetType === "MANUAL" && (
            <label className="flex flex-col gap-1 text-sm">
              <span>{t.fields.manualValue}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                className="border rounded px-3 py-2 text-sm"
                disabled={!hasItems}
              />
            </label>
          )}
        </div>

        <Button onClick={handleRecalc} disabled={!hasItems || recalcPending}>
          {recalcPending ? t.actions.recalcing : t.actions.recalc}
        </Button>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Summary panel                                                        */}
      {/* ------------------------------------------------------------------ */}
      {gp && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium">{t.sections.summary}</h2>
            {gp.incentiveTargetType === "MANUAL" && (
              <span className="text-xs rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-medium">
                {t.manualBadge}
              </span>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm border rounded-md p-4">
            <dt className="text-muted-foreground">{t.fields.salesPrice}</dt>
            <dd className="font-medium">
              {formatAmount(gp.salesPrice)} {c.currencySuffix}
            </dd>

            <dt className="text-muted-foreground">{t.fields.purchaseTotal}</dt>
            <dd>{formatAmount(gp.purchaseTotal)} {c.currencySuffix}</dd>

            <dt className="text-muted-foreground">{t.fields.dealerTotal}</dt>
            <dd>{formatAmount(gp.dealerTotal)} {c.currencySuffix}</dd>

            <dt className="text-muted-foreground">{t.fields.constructionFee}</dt>
            <dd>{formatAmount(gp.constructionFee)} {c.currencySuffix}</dd>

            <dt className="text-muted-foreground">{t.fields.otherCost}</dt>
            <dd>{formatAmount(gp.otherCost)} {c.currencySuffix}</dd>

            <dt className="text-muted-foreground">{t.fields.discount}</dt>
            <dd>{formatAmount(gp.discount)} {c.currencySuffix}</dd>

            <dt className="text-muted-foreground font-medium">{t.fields.projectProfit}</dt>
            <dd className="font-semibold">
              {formatAmount(gp.projectProfit)} {c.currencySuffix}
            </dd>

            <dt className="text-muted-foreground font-medium">{t.fields.wholesaleProfit}</dt>
            <dd className="font-semibold">
              {formatAmount(gp.wholesaleProfit)} {c.currencySuffix}
            </dd>

            <dt className="text-muted-foreground">{t.fields.profitRate}</dt>
            <dd>{formatRate(gp.profitRate)}</dd>

            <dt className="text-muted-foreground">{t.fields.incentiveTargetType}</dt>
            <dd>
              {t.incentiveTargetTypes[gp.incentiveTargetType as "PROJECT_PROFIT" | "WHOLESALE_PROFIT" | "MANUAL"]}
            </dd>

            <dt className="text-muted-foreground font-medium">{t.fields.incentiveTargetProfit}</dt>
            <dd className="font-semibold">
              {formatAmount(gp.incentiveTargetProfit)} {c.currencySuffix}
            </dd>

            {gp.manualAdjustedAt && (
              <>
                <dt className="text-muted-foreground">{t.fields.manualAdjustedAt}</dt>
                <dd>{new Date(gp.manualAdjustedAt).toLocaleString("ja-JP")}</dd>

                <dt className="text-muted-foreground">{t.fields.manualAdjustmentReason}</dt>
                <dd>{gp.manualAdjustmentReason}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Manual adjust panel                                                  */}
      {/* ------------------------------------------------------------------ */}
      {gp && (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{t.sections.adjust}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span>{t.fields.manualValue}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={adjustValue}
                onChange={(e) => setAdjustValue(e.target.value)}
                placeholder={t.placeholders.manualValue}
                className="border rounded px-3 py-2 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span>{t.fields.manualAdjustmentReason}</span>
              <input
                type="text"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder={t.placeholders.adjustReason}
                className="border rounded px-3 py-2 text-sm"
              />
            </label>
          </div>

          <Button onClick={handleAdjust} disabled={adjustPending} variant="secondary">
            {adjustPending ? t.actions.adjusting : t.actions.adjust}
          </Button>
        </section>
      )}
    </div>
  );
}
