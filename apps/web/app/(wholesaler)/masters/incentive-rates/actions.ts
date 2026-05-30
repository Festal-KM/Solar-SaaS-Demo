"use server";

// Incentive-rate master Server Actions (T-02-06 / F-014 / docs/05 §3.3 §4.4).
//
// 二つの Server Action:
//   - `createIncentiveRateAction`  : 新規 row 作成。**重要**: 同 relationship 内に
//                                    `effectiveTo IS NULL` の row があれば、新
//                                    `effectiveFrom` で締める（オーバーラップ
//                                    防止 / 時系列の整合性）。閉じてから INSERT
//                                    する。withTenant() が常に `$transaction`
//                                    内で実行されるため、updateMany + create が
//                                    atomic に走る。
//   - `updateIncentiveRateAction`  : rate / effectiveTo / note のみパッチ可能。
//                                    targetType と effectiveFrom は immutable
//                                    （契約スナップショットや時系列の整合性を
//                                    壊さないため、IncentiveRateUpdateSchema
//                                    でも省く）。
//
// `relationshipId` をクライアントから受け取るので、Server Action 内で「その
// relationship が現在の wholesaler テナントに属するか」を `findUnique` で確認
// する（クロステナント書き込み防止）。RLS でも遮蔽されるが、Insert 系では
// `findUnique` で先に検知して 404 を返す方が UX が良い。
//
// dealer ロールは `incentive_rate.create / update` ポリシーで `assertCan` 時点で
// 403 になる（マトリクスは WHOLESALER_ADMIN のみ）。

import {
  IncentiveRateInputSchema,
  IncentiveRateUpdateSchema,
  type IncentiveRateInput,
  type IncentiveRateUpdate,
} from "@solar/contracts";
import { revalidatePath } from "next/cache";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

const LIST_PATH = "/masters/incentive-rates";

export interface CreateIncentiveRateResult {
  id: string;
}

export const createIncentiveRateAction = withServerActionContext<
  IncentiveRateInput,
  CreateIncentiveRateResult
>(
  {
    action: "incentive_rate.create",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, ctx, input }) => {
    if (!ctx.wholesalerId) {
      throw new ValidationError("wholesalerId is required for incentive-rate master");
    }
    const parsed = IncentiveRateInputSchema.parse(input);

    // RLS via withTenant() restricts visibility to relationships under the
    // active wholesaler tenant — a cross-tenant relationshipId is invisible
    // here and surfaces as NotFound. Without this we'd hit the FK constraint
    // and leak the row's existence via a different error.
    const relationship = await tx.relationship.findUnique({
      where: { id: parsed.relationshipId },
      select: { id: true, wholesalerId: true },
    });
    if (!relationship) {
      throw new NotFoundError("対象の関係が見つかりません");
    }

    // 既存 open row（effectiveTo IS NULL）があれば新 effectiveFrom で締める。
    // ここを effectiveFrom と同値で締めると DB CHECK (effectiveFrom <
    // effectiveTo) を踏んでしまうので「同値で締める」のではなく「同値で締めて
    // も期間が逆転しない rows のみ対象にする」。具体的には既存 row の
    // `effectiveFrom < parsed.effectiveFrom` を満たすものだけ締める。
    // 既存 row の effectiveFrom が新 effectiveFrom 以降の場合（=「過去に遡って
    // 別の率を割り込ませる」想定外シナリオ）はバリデーションエラー。
    const openRows = await tx.incentiveRate.findMany({
      where: {
        relationshipId: parsed.relationshipId,
        effectiveTo: null,
      },
      select: { id: true, effectiveFrom: true },
    });

    for (const open of openRows) {
      if (open.effectiveFrom.getTime() >= parsed.effectiveFrom.getTime()) {
        throw new ValidationError(
          "既存の適用中レコードより前の日付で新規登録はできません。適用開始日を見直してください。",
        );
      }
    }

    if (openRows.length > 0) {
      await tx.incentiveRate.updateMany({
        where: {
          relationshipId: parsed.relationshipId,
          effectiveTo: null,
        },
        data: { effectiveTo: parsed.effectiveFrom },
      });
    }

    const created = await tx.incentiveRate.create({
      data: {
        relationshipId: parsed.relationshipId,
        targetType: parsed.targetType,
        rate: parsed.rate,
        effectiveFrom: parsed.effectiveFrom,
        effectiveTo: parsed.effectiveTo ?? null,
        note: parsed.note ?? null,
        createdBy: ctx.actorUserId,
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    return { id: created.id };
  },
);

export interface UpdateIncentiveRateInput {
  id: string;
  patch: IncentiveRateUpdate;
}

export interface UpdateIncentiveRateResult {
  id: string;
}

export const updateIncentiveRateAction = withServerActionContext<
  UpdateIncentiveRateInput,
  UpdateIncentiveRateResult
>(
  {
    action: "incentive_rate.update",
    resource: ({ ctx }) => (ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined),
  },
  async ({ tx, input }) => {
    const parsed = IncentiveRateUpdateSchema.parse(input.patch);

    // RLS via withTenant() restricts visibility — a missing row is
    // indistinguishable from a cross-tenant access and surfaces as NotFound
    // (docs/05 §9.1).
    const existing = await tx.incentiveRate.findUnique({
      where: { id: input.id },
      select: { id: true, effectiveFrom: true },
    });
    if (!existing) {
      throw new NotFoundError("インセンティブ率が見つかりません");
    }

    // パッチの effectiveTo は existing.effectiveFrom より後でなければならない。
    // Zod 側のチェックは「effectiveFrom と effectiveTo の両方が入力にあるとき」
    // にしか働かないので、ここで明示的に検証する。
    if (parsed.effectiveTo !== undefined) {
      if (parsed.effectiveTo.getTime() <= existing.effectiveFrom.getTime()) {
        throw new ValidationError("適用終了日は適用開始日より後にしてください");
      }
    }

    const updated = await tx.incentiveRate.update({
      where: { id: input.id },
      data: {
        ...(parsed.rate !== undefined ? { rate: parsed.rate } : {}),
        ...("effectiveTo" in parsed ? { effectiveTo: parsed.effectiveTo ?? null } : {}),
        ...("note" in parsed ? { note: parsed.note ?? null } : {}),
      },
      select: { id: true },
    });

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${input.id}`);
    return { id: updated.id };
  },
);
