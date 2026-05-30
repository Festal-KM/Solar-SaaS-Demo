"use server";

// 手数料設定保存 — DealerCommissionRate の upsert + 変更履歴 1 行追記.
//
// 三段イディオム: auth → assertCan('commission_setting.update') → withTenant tx。
// relationshipId はクライアントから渡るが、wholesalerId は ctx ではなく
// `Relationship` 自身から（tx.relationship.findUnique 経由で RLS 越しに）
// 取得することでテナント越境を物理的に防ぐ。relationship が見えない =
// 別テナント or 存在しない → NotFoundError。
//
// 差分サマリは upsert 前の現行値と新値を比較して生成。何も変わらなくても
// 「明示的な保存アクション」として履歴 1 行を残す（"値の変更なし"）。

import { revalidatePath } from "next/cache";

import { DealerCommissionRateUpdateSchema } from "@solar/contracts";
import type { DealerCommissionRateUpdateInput } from "@solar/contracts";

import { NotFoundError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const SETTINGS_PATH = "/commissions/settings";

// 表示用ラベル（履歴サマリ内に埋め込むため、ユーザ向け日本語固定）。
const LBL = {
  tossUp: "トスアップ率",
  closing: "クロージング率",
  applyFrom: "適用開始日",
  applyTo: "適用終了日",
  noEnd: "終了日なし",
  noChange: "値の変更なし",
} as const;

// Local-TZ safe YYYY-MM-DD (toISOString は JST 越境で日付がずれる)。
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 1.5 → "1.5%"; 整数も "3%" ではなく `3.0%` のような桁揃えは不要なのでそのまま。
function formatRate(rate: number): string {
  return `${rate}%`;
}

function formatDate(value: string | null): string {
  return value ?? LBL.noEnd;
}

function buildSummary(
  before: {
    tossUpRate: number;
    closingRate: number;
    applyFrom: string;
    applyTo: string | null;
  } | null,
  after: {
    tossUpRate: number;
    closingRate: number;
    applyFrom: string;
    applyTo: string | null;
  },
): string {
  if (!before) {
    return `新規作成（${LBL.tossUp} ${formatRate(after.tossUpRate)} / ${LBL.closing} ${formatRate(
      after.closingRate,
    )}）`;
  }
  const parts: string[] = [];
  if (before.tossUpRate !== after.tossUpRate) {
    parts.push(
      `${LBL.tossUp} ${formatRate(before.tossUpRate)} → ${formatRate(after.tossUpRate)}`,
    );
  }
  if (before.closingRate !== after.closingRate) {
    parts.push(
      `${LBL.closing} ${formatRate(before.closingRate)} → ${formatRate(after.closingRate)}`,
    );
  }
  if (before.applyFrom !== after.applyFrom) {
    parts.push(`${LBL.applyFrom} ${before.applyFrom} → ${after.applyFrom}`);
  }
  if ((before.applyTo ?? null) !== (after.applyTo ?? null)) {
    parts.push(
      `${LBL.applyTo} ${formatDate(before.applyTo)} → ${formatDate(after.applyTo)}`,
    );
  }
  if (parts.length === 0) return LBL.noChange;
  return parts.join(" / ");
}

export interface SaveDealerCommissionRateResult {
  id: string;
}

export const saveDealerCommissionRate = withServerActionContext<
  DealerCommissionRateUpdateInput,
  SaveDealerCommissionRateResult
>(
  {
    action: "commission_setting.update",
  },
  async ({ tx, ctx, input }) => {
    const parsed = DealerCommissionRateUpdateSchema.parse(input);

    // RLS スコープ内で relationship 解決 — 別テナントなら見えない。
    const rel = await tx.relationship.findUnique({
      where: { id: parsed.relationshipId },
      select: { id: true, wholesalerId: true },
    });
    if (!rel) {
      throw new NotFoundError("対象の関係が見つかりません");
    }

    // 現行値を取得して差分サマリを構築する。
    const current = await tx.dealerCommissionRate.findUnique({
      where: { relationshipId: parsed.relationshipId },
      select: {
        tossUpRate: true,
        closingRate: true,
        applyFrom: true,
        applyTo: true,
      },
    });

    const before = current
      ? {
          tossUpRate: Number(current.tossUpRate),
          closingRate: Number(current.closingRate),
          applyFrom: toLocalDateString(current.applyFrom),
          applyTo: current.applyTo ? toLocalDateString(current.applyTo) : null,
        }
      : null;

    const after = {
      tossUpRate: parsed.tossUpRate,
      closingRate: parsed.closingRate,
      applyFrom: parsed.applyFrom,
      applyTo: parsed.applyTo ?? null,
    };

    const summary = buildSummary(before, after);

    const applyFromDate = new Date(parsed.applyFrom);
    const applyToDate = parsed.applyTo ? new Date(parsed.applyTo) : null;

    const upserted = await tx.dealerCommissionRate.upsert({
      where: { relationshipId: parsed.relationshipId },
      create: {
        wholesalerId: rel.wholesalerId,
        relationshipId: parsed.relationshipId,
        tossUpRate: parsed.tossUpRate,
        closingRate: parsed.closingRate,
        applyFrom: applyFromDate,
        applyTo: applyToDate,
        updatedByUserId: ctx.actorUserId,
      },
      update: {
        tossUpRate: parsed.tossUpRate,
        closingRate: parsed.closingRate,
        applyFrom: applyFromDate,
        applyTo: applyToDate,
        updatedByUserId: ctx.actorUserId,
      },
      select: { id: true },
    });

    await tx.dealerCommissionRateChange.create({
      data: {
        rateId: upserted.id,
        changedByUserId: ctx.actorUserId,
        summary,
      },
    });

    revalidatePath(SETTINGS_PATH);
    return { id: upserted.id };
  },
);
