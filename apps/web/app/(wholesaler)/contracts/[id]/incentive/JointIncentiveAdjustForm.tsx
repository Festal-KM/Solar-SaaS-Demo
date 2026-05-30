"use client";

// JointIncentiveAdjustForm — T-06-03 / F-047 / docs/04 §S-050 タブ.
//
// Renders a distribution table for JOINT incentives.
// DRAFT rows: amount input + reason input (editable).
// FINALIZED rows: read-only summary + adjustment history.
//
// On submit: calls adjustJointIncentiveAction with all DRAFT entries that
// have been filled in.

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import type { IncentiveRow } from "./page";
import { adjustJointIncentiveAction } from "./actions";

interface Props {
  contractId: string;
  incentives: IncentiveRow[];
}

interface RowState {
  amount: string;
  reason: string;
}

export function JointIncentiveAdjustForm({ contractId, incentives }: Props) {
  const t = labels.incentiveAdjust;
  const c = labels.common;

  const draftIncentives = incentives.filter((inc) => inc.status === "DRAFT");
  const finalizedIncentives = incentives.filter((inc) => inc.status !== "DRAFT");

  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const inc of draftIncentives) {
      init[inc.relationshipId] = { amount: inc.amount, reason: "" };
    }
    return init;
  });

  const [pending, setPending] = useState(false);

  function handleAmountChange(relationshipId: string, value: string) {
    setRows((prev) => ({
      ...prev,
      [relationshipId]: { ...prev[relationshipId]!, amount: value },
    }));
  }

  function handleReasonChange(relationshipId: string, value: string) {
    setRows((prev) => ({
      ...prev,
      [relationshipId]: { ...prev[relationshipId]!, reason: value },
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const distributions = draftIncentives
      .map((inc) => ({
        relationshipId: inc.relationshipId,
        amount: rows[inc.relationshipId]?.amount ?? "0",
        reason: rows[inc.relationshipId]?.reason ?? "",
      }))
      .filter((d) => d.reason.trim() !== "");

    if (distributions.length === 0) {
      toast.error(t.errors.noDistributions);
      return;
    }

    setPending(true);
    try {
      await adjustJointIncentiveAction({ contractId, distributions });
      toast.success(t.feedback.done);
    } catch (err) {
      const msg = err instanceof Error ? err.message : c.unknownError;
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* DRAFT rows — editable */}
      {draftIncentives.length > 0 && (
        <div className="border-border rounded-md border p-4 space-y-4">
          <h2 className="font-medium">{t.sections.distributions}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.columns.relationship}</th>
                  <th className="px-3 py-2 font-medium">{t.columns.currentAmount}</th>
                  <th className="px-3 py-2 font-medium">{t.columns.status}</th>
                  <th className="px-3 py-2 font-medium">{t.columns.adjustAmount}</th>
                  <th className="px-3 py-2 font-medium">{t.columns.reason}</th>
                </tr>
              </thead>
              <tbody>
                {draftIncentives.map((inc) => (
                  <tr key={inc.relationshipId} className="border-border border-t">
                    <td className="px-3 py-2 font-medium">{inc.dealerName}</td>
                    <td className="px-3 py-2">
                      {Number(inc.amount).toLocaleString("ja-JP")} {c.currencySuffix}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-amber-600 text-xs">
                        {t.statuses.DRAFT}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <Label htmlFor={`amount-${inc.relationshipId}`} className="sr-only">
                          {t.columns.adjustAmount}
                        </Label>
                        <Input
                          id={`amount-${inc.relationshipId}`}
                          type="text"
                          inputMode="numeric"
                          placeholder={t.placeholders.amount}
                          value={rows[inc.relationshipId]?.amount ?? ""}
                          onChange={(e) => handleAmountChange(inc.relationshipId, e.target.value)}
                          disabled={pending}
                          className="w-36"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <Label htmlFor={`reason-${inc.relationshipId}`} className="sr-only">
                          {t.columns.reason}
                        </Label>
                        <Input
                          id={`reason-${inc.relationshipId}`}
                          type="text"
                          placeholder={t.placeholders.reason}
                          value={rows[inc.relationshipId]?.reason ?? ""}
                          onChange={(e) => handleReasonChange(inc.relationshipId, e.target.value)}
                          disabled={pending}
                          className="w-56"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? t.actions.submitting : t.actions.submit}
            </Button>
          </div>
        </div>
      )}

      {/* FINALIZED / other status rows — read-only */}
      {finalizedIncentives.length > 0 && (
        <div className="border-border rounded-md border p-4 space-y-4">
          <h2 className="font-medium">{t.sections.history}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.columns.relationship}</th>
                  <th className="px-3 py-2 font-medium">{t.columns.currentAmount}</th>
                  <th className="px-3 py-2 font-medium">{t.columns.status}</th>
                </tr>
              </thead>
              <tbody>
                {finalizedIncentives.map((inc) => (
                  <tr key={inc.relationshipId} className="border-border border-t">
                    <td className="px-3 py-2 font-medium">{inc.dealerName}</td>
                    <td className="px-3 py-2">
                      {Number(inc.amount).toLocaleString("ja-JP")} {c.currencySuffix}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-green-700 text-xs">
                        {t.statuses[inc.status as keyof typeof t.statuses] ?? inc.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {draftIncentives.length === 0 && (
        <p className="text-sm text-muted-foreground">{t.allFinalized}</p>
      )}
    </form>
  );
}
