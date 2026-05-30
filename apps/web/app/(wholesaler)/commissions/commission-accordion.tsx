"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import type { CaseScope, DealerCommissionSummary, PaymentStatus } from "./data";

const t = labels.commission.listPage;

const STATUS_OPTIONS: PaymentStatus[] = ["pending", "unpaid", "partial", "paid"];

// 調整項目（加算・減算）。amount は編集中の生文字列で保持し、合計計算時に数値へ
// 変換する（負数許容、空 / 不正は 0 扱い）。これらは全てクライアント側のサンプル
// 状態であり永続化されない。実データ化時はサーバアクションで保存する（follow-up）。
interface Adjustment {
  key: string;
  label: string;
  amount: string;
}

function parseAmount(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// 支払状況を TIP（チップ）風に色分け。選択値で背景/文字色が変わる。
function statusChipClass(s: PaymentStatus): string {
  switch (s) {
    case "paid":
      return "bg-emerald-50 text-emerald-700";
    case "partial":
      return "bg-amber-50 text-amber-700";
    case "pending":
      return "bg-sky-50 text-sky-700";
    case "unpaid":
      return "bg-slate-100 text-slate-600";
  }
}

// 負数対応の円表記（例: -¥50,000）。
function formatYen(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}¥${Math.abs(amount).toLocaleString("ja-JP")}`;
}

// "2026-06" → "2026年06月"。
function formatMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${m}月`;
}

// 最終更新日は YYYY/MM/DD HH:mm（ja-JP, JST 表示）。
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ScopeChip({ scope }: { scope: CaseScope }) {
  const cls =
    scope === "closing" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700";
  return (
    <span
      className={["inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", cls].join(
        " ",
      )}
    >
      {t.scopeLabels[scope]}
    </span>
  );
}

function StatusChipSelect({
  status,
  onStatusChange,
}: {
  status: PaymentStatus;
  onStatusChange: (next: PaymentStatus) => void;
}) {
  return (
    <span className="relative inline-flex">
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value as PaymentStatus)}
        aria-label={t.columns.paymentStatus}
        className={[
          "cursor-pointer appearance-none rounded-full py-0.5 pl-2.5 pr-6 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/30",
          statusChipClass(status),
        ].join(" ")}
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {t.paymentStatusLabels[s]}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 opacity-60"
      />
    </span>
  );
}

function CaseTable({ dealer }: { dealer: DealerCommissionSummary }) {
  const c = t.columns;
  const th = "px-4 py-2 text-xs font-medium uppercase tracking-wider text-mute-light";
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-hairline-light text-left">
          <th className={th}>{c.customerName}</th>
          <th className={`${th} text-right`}>{c.contractAmount}</th>
          <th className={th}>{c.scope}</th>
          <th className={`${th} text-right`}>{c.incentiveRate}</th>
          <th className={`${th} text-right`}>{c.fee}</th>
          <th className={th}>{c.note}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline-light">
        {dealer.cases.map((cs) => (
          <tr key={cs.id} className="hover:bg-white/60">
            <td className="px-4 py-2.5 font-medium text-ink">{cs.customerName}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-body-light">
              {formatYen(cs.contractAmount)}
            </td>
            <td className="px-4 py-2.5">
              <ScopeChip scope={cs.scope} />
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-body-light">
              {cs.incentiveRate}%
            </td>
            <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink">
              {formatYen(cs.fee)}
            </td>
            <td className="px-4 py-2.5 text-body-light">{cs.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 調整項目（加算・減算）セクション。金額は負数許容。
function AdjustmentSection({
  adjustments,
  onAdd,
  onChange,
  onRemove,
}: {
  adjustments: Adjustment[];
  onAdd: () => void;
  onChange: (key: string, patch: Partial<Pick<Adjustment, "label" | "amount">>) => void;
  onRemove: (key: string) => void;
}) {
  const a = t.adjust;
  return (
    <div className="mt-3 rounded-md border border-hairline-light bg-white/70 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{a.title}</span>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus size={14} />
          {a.add}
        </Button>
      </div>

      {adjustments.length === 0 ? (
        <p className="text-xs text-mute-light">{labels.common.notSet}</p>
      ) : (
        <ul className="space-y-2">
          {adjustments.map((adj) => (
            <li key={adj.key} className="flex items-center gap-2">
              <input
                type="text"
                value={adj.label}
                placeholder={a.itemPlaceholder}
                aria-label={a.itemPlaceholder}
                onChange={(e) => onChange(adj.key, { label: e.target.value })}
                className="min-w-0 flex-1 rounded-md border border-hairline-light bg-white px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <input
                type="number"
                value={adj.amount}
                placeholder={a.amountPlaceholder}
                aria-label={a.amountPlaceholder}
                onChange={(e) => onChange(adj.key, { amount: e.target.value })}
                className="w-36 rounded-md border border-hairline-light bg-white px-2.5 py-1.5 text-right text-sm tabular-nums text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                aria-label={a.remove}
                title={a.remove}
                onClick={() => onRemove(adj.key)}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-mute-light transition-colors hover:bg-surface-soft hover:text-ink"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface AccordionRowProps {
  dealer: DealerCommissionSummary;
  status: PaymentStatus;
  onStatusChange: (next: PaymentStatus) => void;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  adjustments: Adjustment[];
  onAddAdjustment: () => void;
  onChangeAdjustment: (
    key: string,
    patch: Partial<Pick<Adjustment, "label" | "amount">>,
  ) => void;
  onRemoveAdjustment: (key: string) => void;
}

function AccordionRow({
  dealer,
  status,
  onStatusChange,
  checked,
  onCheckedChange,
  adjustments,
  onAddAdjustment,
  onChangeAdjustment,
  onRemoveAdjustment,
}: AccordionRowProps) {
  const [open, setOpen] = useState(false);
  const b = t.band;

  // 案件小計（dealer.totalFee）+ 調整合計 = 手数料合計。サマリ行・合計行に反映。
  const caseSubtotal = dealer.totalFee;
  const adjustmentTotal = useMemo(
    () => adjustments.reduce((sum, adj) => sum + parseAmount(adj.amount), 0),
    [adjustments],
  );
  const finalTotal = caseSubtotal + adjustmentTotal;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="flex w-full cursor-pointer items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-surface-soft/30"
      >
        <span className="flex w-5 shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheckedChange(e.target.checked)}
            aria-label={dealer.dealerName}
            className="size-4 cursor-pointer rounded border-hairline-light text-primary focus:ring-primary/30"
          />
        </span>

        <span className="min-w-0 flex-1 truncate font-medium text-primary">
          {dealer.dealerName}
        </span>

        <span className="hidden w-24 shrink-0 text-sm tabular-nums text-body-light sm:block">
          {formatMonth(dealer.targetMonth)}
        </span>

        <span className="hidden w-20 shrink-0 text-right text-sm tabular-nums text-body-light sm:block">
          {dealer.customerCount}
          {t.customerCountUnit}
        </span>

        <span className="w-28 shrink-0 text-right font-semibold tabular-nums text-ink">
          {formatYen(finalTotal)}
        </span>

        <span className="w-28 shrink-0" onClick={(e) => e.stopPropagation()}>
          <StatusChipSelect status={status} onStatusChange={onStatusChange} />
        </span>

        <span className="hidden w-32 shrink-0 text-right text-xs tabular-nums text-mute-light lg:block">
          {formatDateTime(dealer.updatedAt)}
        </span>

        <ChevronDown
          size={16}
          className={["w-8 shrink-0 text-mute-light transition-transform", open ? "rotate-180" : ""].join(
            " ",
          )}
        />
      </div>

      <div
        className={[
          "grid transition-[grid-template-rows] duration-300 ease-in-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        ].join(" ")}
      >
        <div className="overflow-hidden">
          <div className="border-t border-hairline-light bg-surface-soft/20 px-4 py-3">
            {/* 集計バンド（小計は案件小計 = caseSubtotal のまま）。 */}
            <div className="mb-3 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-md bg-white/70 px-4 py-2.5 text-sm">
              <span>
                <span className="mr-2 text-xs text-mute-light">{b.customerCount}</span>
                <span className="font-semibold tabular-nums text-ink">
                  {dealer.customerCount}
                  {t.customerCountUnit}
                </span>
              </span>
              <span>
                <span className="mr-2 text-xs text-mute-light">{b.closingCount}</span>
                <span className="font-semibold tabular-nums text-emerald-600">
                  {dealer.closingCount}
                  {t.caseCountUnit}
                </span>
              </span>
              <span>
                <span className="mr-2 text-xs text-mute-light">{b.tossUpCount}</span>
                <span className="font-semibold tabular-nums text-amber-600">
                  {dealer.tossUpCount}
                  {t.caseCountUnit}
                </span>
              </span>
              <span className="ml-auto">
                <span className="mr-2 text-xs text-mute-light">{b.subtotal}</span>
                <span className="font-semibold tabular-nums text-primary">
                  {formatYen(caseSubtotal)}
                </span>
              </span>
            </div>
            <CaseTable dealer={dealer} />

            <AdjustmentSection
              adjustments={adjustments}
              onAdd={onAddAdjustment}
              onChange={onChangeAdjustment}
              onRemove={onRemoveAdjustment}
            />

            {/* 合計 = 案件小計 + 調整合計（負数対応表記）。 */}
            <div className="mt-3 flex items-center justify-end gap-3 border-t border-hairline-light pt-3">
              <span className="text-sm font-medium text-mute-light">{t.adjust.total}</span>
              <span className="text-base font-semibold tabular-nums text-ink">
                {formatYen(finalTotal)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColumnHeaderRow() {
  const c = t.columns;
  return (
    <div className="hidden items-center gap-4 border-b border-hairline-light bg-surface-soft/30 px-6 py-2 text-xs font-medium uppercase tracking-wider text-mute-light sm:flex">
      <span className="w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{c.dealerName}</span>
      <span className="hidden w-24 shrink-0 sm:block">{c.targetMonth}</span>
      <span className="hidden w-20 shrink-0 text-right sm:block">{c.customerCount}</span>
      <span className="w-28 shrink-0 text-right">{c.totalFee}</span>
      <span className="w-28 shrink-0">{c.paymentStatus}</span>
      <span className="hidden w-32 shrink-0 text-right lg:block">{c.updatedAt}</span>
      <span className="w-8 shrink-0 text-right">{c.expand}</span>
    </div>
  );
}

interface CommissionAccordionProps {
  dealers: DealerCommissionSummary[];
}

export function CommissionAccordion({ dealers }: CommissionAccordionProps) {
  // 全てクライアント側のサンプル状態（永続化なし）。実データ化時は支払状況更新 /
  // 調整項目保存をサーバアクションへ置き換える（follow-up）。
  const [statuses, setStatuses] = useState<Record<string, PaymentStatus>>(() =>
    Object.fromEntries(dealers.map((d) => [d.id, d.paymentStatus])),
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [adjustments, setAdjustments] = useState<Record<string, Adjustment[]>>({});
  const [bulkStatus, setBulkStatus] = useState<PaymentStatus>("paid");

  const bk = t.bulk;
  const allSelected = dealers.length > 0 && selected.size === dealers.length;

  function setStatus(id: string, next: PaymentStatus) {
    setStatuses((prev) => ({ ...prev, [id]: next }));
  }

  function toggleSelected(id: string, next: boolean) {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  function toggleAll(next: boolean) {
    setSelected(next ? new Set(dealers.map((d) => d.id)) : new Set());
  }

  function applyBulk() {
    setStatuses((prev) => {
      const copy = { ...prev };
      for (const id of selected) copy[id] = bulkStatus;
      return copy;
    });
    setSelected(new Set());
  }

  function addAdjustment(id: string) {
    setAdjustments((prev) => ({
      ...prev,
      [id]: [
        ...(prev[id] ?? []),
        { key: `adj-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label: "", amount: "" },
      ],
    }));
  }

  function changeAdjustment(
    id: string,
    key: string,
    patch: Partial<Pick<Adjustment, "label" | "amount">>,
  ) {
    setAdjustments((prev) => ({
      ...prev,
      [id]: (prev[id] ?? []).map((adj) => (adj.key === key ? { ...adj, ...patch } : adj)),
    }));
  }

  function removeAdjustment(id: string, key: string) {
    setAdjustments((prev) => ({
      ...prev,
      [id]: (prev[id] ?? []).filter((adj) => adj.key !== key),
    }));
  }

  return (
    <div>
      {/* 一括支払状況設定ツールバー。 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline-light bg-surface-soft/30 px-6 py-2.5">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-body-light">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => toggleAll(e.target.checked)}
            aria-label={bk.selectAll}
            className="size-4 cursor-pointer rounded border-hairline-light text-primary focus:ring-primary/30"
          />
          {bk.selectAll}
        </label>

        {selected.size > 0 && (
          <>
            <span className="text-sm tabular-nums text-mute-light">
              {bk.selectedCount.replace("{n}", String(selected.size))}
            </span>
            <span className="relative inline-flex">
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value as PaymentStatus)}
                aria-label={t.columns.paymentStatus}
                className="cursor-pointer appearance-none rounded-full border border-hairline-light bg-white py-1 pl-3 pr-7 text-xs font-medium text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t.paymentStatusLabels[s]}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-60"
              />
            </span>
            <Button type="button" size="sm" onClick={applyBulk}>
              {bk.apply}
            </Button>
          </>
        )}
      </div>

      <ColumnHeaderRow />

      <div className="divide-y divide-hairline-light">
        {dealers.map((d) => (
          <AccordionRow
            key={d.id}
            dealer={d}
            status={statuses[d.id] ?? d.paymentStatus}
            onStatusChange={(next) => setStatus(d.id, next)}
            checked={selected.has(d.id)}
            onCheckedChange={(next) => toggleSelected(d.id, next)}
            adjustments={adjustments[d.id] ?? []}
            onAddAdjustment={() => addAdjustment(d.id)}
            onChangeAdjustment={(key, patch) => changeAdjustment(d.id, key, patch)}
            onRemoveAdjustment={(key) => removeAdjustment(d.id, key)}
          />
        ))}
      </div>
    </div>
  );
}
