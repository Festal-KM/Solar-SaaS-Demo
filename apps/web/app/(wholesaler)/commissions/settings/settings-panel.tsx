"use client";

import { ArrowRight, Calculator, Coins, History } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { saveDealerCommissionRate } from "./actions";
import type { DealerRateSetting } from "./data";

const t = labels.commission.settingsPage;

function formatYen(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}¥${Math.abs(Math.round(amount)).toLocaleString("ja-JP")}`;
}

// "2026-04-01" → "2026/04/01"。null は終了日なし表記へ。
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}/${m}/${d}`;
}

// number input の生文字列を率(%)としてパース。空 / 不正は 0 扱い、負数は 0 にクランプ。
function parseRate(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function DealerList({
  dealers,
  selectedId,
  onSelect,
}: {
  dealers: DealerRateSetting[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const c = t.columns;
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-hairline-light px-5 py-4">
        <h2 className="text-sm font-medium text-ink">{t.listTitle}</h2>
      </div>

      {dealers.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-mute-light">{t.empty}</p>
      ) : (
        <>
          <div className="hidden grid-cols-[1fr_auto_auto] gap-4 border-b border-hairline-light bg-surface-soft/30 px-5 py-2 text-xs font-medium uppercase tracking-wider text-mute-light sm:grid">
            <span>{c.dealerName}</span>
            <span className="w-16 text-right">{c.tossUpRate}</span>
            <span className="w-16 text-right">{c.closingRate}</span>
          </div>

          <ul className="divide-y divide-hairline-light">
            {dealers.map((d) => {
              const active = d.id === selectedId;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(d.id)}
                    aria-current={active}
                    className={[
                      "grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3.5 text-left transition-colors",
                      active
                        ? "border-l-2 border-primary bg-primary/5"
                        : "border-l-2 border-transparent hover:bg-surface-soft/40",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "min-w-0 truncate text-sm",
                        active ? "font-semibold text-primary" : "font-medium text-ink",
                      ].join(" ")}
                    >
                      {d.dealerName}
                    </span>
                    <span className="w-16 text-right text-sm tabular-nums text-amber-700">
                      {d.tossUpRate}
                      {t.percentSuffix}
                    </span>
                    <span className="w-16 text-right text-sm tabular-nums text-blue-700">
                      {d.closingRate}
                      {t.percentSuffix}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

function RateCard({
  variant,
  title,
  description,
  value,
  onChange,
}: {
  variant: "tossUp" | "closing";
  title: string;
  description: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const accent =
    variant === "tossUp"
      ? {
          bg: "bg-amber-50/70",
          border: "border-amber-200",
          icon: "text-amber-600",
          value: "text-amber-700",
        }
      : {
          bg: "bg-blue-50/70",
          border: "border-blue-200",
          icon: "text-blue-600",
          value: "text-blue-700",
        };
  return (
    <div className={["rounded-md border p-4", accent.bg, accent.border].join(" ")}>
      <div className="flex items-center gap-2">
        <Coins size={16} className={accent.icon} />
        <span className="text-sm font-medium text-ink">{title}</span>
      </div>
      <p className="mt-1 text-xs text-mute-light">{description}</p>

      <div className="mt-4 flex items-end gap-2">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={title}
          className="h-12 w-28 bg-white text-right text-2xl font-semibold tabular-nums text-ink"
        />
        <span className={["pb-2 text-2xl font-semibold tabular-nums", accent.value].join(" ")}>
          {t.percentSuffix}
        </span>
      </div>
    </div>
  );
}

function ApplyPeriod({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string; // 空文字列なら終了日なし
  onFromChange: (next: string) => void;
  onToChange: (next: string) => void;
}) {
  const p = t.applyPeriod;
  return (
    <section>
      <h3 className="mb-3 text-sm font-medium text-ink">{t.sections.applyPeriod}</h3>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-md border border-hairline-light bg-surface-soft/30 px-4 py-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-mute-light">{p.from}</span>
          <Input
            type="date"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
            className="w-44 tabular-nums"
          />
        </label>
        <ArrowRight size={14} className="mb-3 text-mute-light" />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-mute-light">{p.to}</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => onToChange(e.target.value)}
            className="w-44 tabular-nums"
          />
        </label>
        <span className="mb-3 text-xs text-mute-light">{p.noEndHint}</span>
      </div>
    </section>
  );
}

function PreviewCalculator({
  tossUpRate,
  closingRate,
}: {
  tossUpRate: number;
  closingRate: number;
}) {
  const [baseRaw, setBaseRaw] = useState("3000000");
  const p = t.preview;

  const base = useMemo(() => {
    const n = Number(baseRaw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [baseRaw]);

  const tossUpFee = (base * tossUpRate) / 100;
  const closingFee = (base * closingRate) / 100;

  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
        <Calculator size={16} className="text-mute-light" />
        {t.sections.preview}
      </h3>
      <div className="rounded-md border border-hairline-light bg-surface-soft/30 p-4">
        <label className="block">
          <span className="mb-1.5 block text-xs text-mute-light">{p.baseAmount}</span>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={10000}
              value={baseRaw}
              placeholder={p.baseAmountPlaceholder}
              onChange={(e) => setBaseRaw(e.target.value)}
              className="w-48 text-right tabular-nums"
            />
            <span className="text-sm text-body-light">{labels.common.currencySuffix}</span>
          </div>
        </label>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-amber-200 bg-amber-50/70 px-4 py-3">
            <div className="text-xs text-mute-light">{p.tossUpFee}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-amber-700">
              {formatYen(tossUpFee)}
            </div>
            <div className="mt-0.5 text-xs tabular-nums text-mute-light">
              {tossUpRate}
              {t.percentSuffix}
            </div>
          </div>
          <div className="rounded-md border border-blue-200 bg-blue-50/70 px-4 py-3">
            <div className="text-xs text-mute-light">{p.closingFee}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-blue-700">
              {formatYen(closingFee)}
            </div>
            <div className="mt-0.5 text-xs tabular-nums text-mute-light">
              {closingRate}
              {t.percentSuffix}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HistoryTable({ history }: { history: DealerRateSetting["history"] }) {
  const h = t.historyColumns;
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
        <History size={16} className="text-mute-light" />
        {t.sections.history}
      </h3>
      {history.length === 0 ? (
        <p className="rounded-md border border-hairline-light bg-surface-soft/30 px-4 py-6 text-center text-sm text-mute-light">
          {t.historyEmpty}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-hairline-light">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline-light bg-surface-soft/30 text-left">
                <th className="w-28 px-4 py-2 text-xs font-medium uppercase tracking-wider text-mute-light">
                  {h.date}
                </th>
                <th className="w-32 px-4 py-2 text-xs font-medium uppercase tracking-wider text-mute-light">
                  {h.changedBy}
                </th>
                <th className="px-4 py-2 text-xs font-medium uppercase tracking-wider text-mute-light">
                  {h.summary}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline-light">
              {history.map((rc) => (
                <tr key={rc.id}>
                  <td className="px-4 py-2.5 tabular-nums text-body-light">{formatDate(rc.date)}</td>
                  <td className="px-4 py-2.5 text-body-light">{rc.changedBy}</td>
                  <td className="px-4 py-2.5 text-ink">{rc.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ConfigPanel({ setting }: { setting: DealerRateSetting }) {
  // 編集中の率/適用期間はクライアント側のローカル状態。二次店を切り替えると
  // key で再マウントされ、選択先の初期値がロードされる。保存成功時は initial を
  // current で上書きして dirty=false に戻し、router.refresh() でサーバから
  // 最新履歴を取り直す。
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [initial, setInitial] = useState({
    tossUpRaw: String(setting.tossUpRate),
    closingRaw: String(setting.closingRate),
    applyFromRaw: setting.applyFrom.slice(0, 10),
    applyToRaw: setting.applyTo ? setting.applyTo.slice(0, 10) : "",
  });
  const [tossUpRaw, setTossUpRaw] = useState(initial.tossUpRaw);
  const [closingRaw, setClosingRaw] = useState(initial.closingRaw);
  const [applyFromRaw, setApplyFromRaw] = useState(initial.applyFromRaw);
  const [applyToRaw, setApplyToRaw] = useState(initial.applyToRaw);

  const tossUpRate = parseRate(tossUpRaw);
  const closingRate = parseRate(closingRaw);

  const isDirty =
    tossUpRaw !== initial.tossUpRaw ||
    closingRaw !== initial.closingRaw ||
    applyFromRaw !== initial.applyFromRaw ||
    applyToRaw !== initial.applyToRaw;

  function handleSave() {
    // 入力の事前チェック（サーバ側 Zod でも弾くが UX のため先に toast）。
    if (!applyFromRaw) {
      toast.error(t.applyPeriod.from);
      return;
    }
    const tu = Number(tossUpRaw);
    const cl = Number(closingRaw);
    if (!Number.isFinite(tu) || tu < 0 || tu > 100) {
      toast.error(t.rateCards.tossUp);
      return;
    }
    if (!Number.isFinite(cl) || cl < 0 || cl > 100) {
      toast.error(t.rateCards.closing);
      return;
    }

    startTransition(async () => {
      try {
        await saveDealerCommissionRate({
          relationshipId: setting.id,
          tossUpRate: tu,
          closingRate: cl,
          applyFrom: applyFromRaw,
          applyTo: applyToRaw || null,
        });
        setInitial({ tossUpRaw, closingRaw, applyFromRaw, applyToRaw });
        toast.success(labels.common.saved);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : labels.common.unknownError;
        toast.error(message);
      }
    });
  }

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between gap-4 border-b border-hairline-light px-6 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-ink">{setting.dealerName}</h2>
          <p className="mt-0.5 text-xs text-mute-light">{t.sections.baseSetting}</p>
        </div>
        <Button type="button" size="sm" disabled={!isDirty || isPending} onClick={handleSave}>
          {isPending ? labels.common.saving : t.save}
        </Button>
      </div>

      <div className="space-y-6 px-6 py-5">
        <section>
          <h3 className="mb-3 text-sm font-medium text-ink">{t.sections.rates}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <RateCard
              variant="tossUp"
              title={t.rateCards.tossUp}
              description={t.rateCards.tossUpDesc}
              value={tossUpRaw}
              onChange={setTossUpRaw}
            />
            <RateCard
              variant="closing"
              title={t.rateCards.closing}
              description={t.rateCards.closingDesc}
              value={closingRaw}
              onChange={setClosingRaw}
            />
          </div>
        </section>

        <ApplyPeriod
          from={applyFromRaw}
          to={applyToRaw}
          onFromChange={setApplyFromRaw}
          onToChange={setApplyToRaw}
        />

        <PreviewCalculator tossUpRate={tossUpRate} closingRate={closingRate} />

        <HistoryTable history={setting.history} />
      </div>
    </Card>
  );
}

export function SettingsPanel({ dealers }: { dealers: DealerRateSetting[] }) {
  const [selectedId, setSelectedId] = useState(dealers[0]?.id ?? "");
  const selected = dealers.find((d) => d.id === selectedId) ?? dealers[0];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <DealerList dealers={dealers} selectedId={selected?.id ?? ""} onSelect={setSelectedId} />
      </div>
      <div className="lg:col-span-2">
        {/* key で二次店切替時に編集状態を破棄し、選択先の率を初期値として再ロードする。 */}
        {selected ? <ConfigPanel key={selected.id} setting={selected} /> : null}
      </div>
    </div>
  );
}
