"use server";

// Server Actions for the dealer preference workflow (T-03-06 / F-021 /
// docs/05 §4.5 / docs/04 §1.5 S-060).
//
// Two actions:
//   submitPreferenceAction   — 新規/更新 upsert。`(eventCandidateId, relationshipId)`
//                              で upsert。EventCandidate.status='OPEN' かつ
//                              deadlineAt > now() のみ許容。
//   withdrawPreferenceAction — 期限内かつ status='OPEN' のときのみ delete。
//                              期限超過は DealerPreferenceClosedError (409,
//                              DEADLINE_PASSED) / status NOT OPEN は
//                              InvalidStateTransitionError (422)。
//                              ※ docs/05 §4.5 に「withdraw は OPEN かつ deadline
//                              前のみ許容」を追記済み。
//
// 不変条件（多層防御）：
//   1. 二次店ロールのみ (assertCan で弾く)。
//   2. 入力 relationshipId は ctx.relationshipIds[] に含まれること
//      (assertCan が requireTenantScope=true で TenantIsolationError を投げる)。
//   3. EventCandidate は二次店から可視 (= EventCandidateVisibility.isVisible=true で
//      自社 relationshipId と結びつく行が存在する) であること。可視範囲外なら
//      NotFoundError (404)。
//   4. EventCandidate.status === 'OPEN' でなければ
//      InvalidStateTransitionError (422)。DRAFT / CLOSED / DECIDED / CANCELLED は不可。
//   5. deadlineAt > now() でなければ DealerPreferenceClosedError (409, DEADLINE_PASSED)。
//
// 期限超過判定はサーバサイドで必ず再検証する。クライアントの disabled は UX 用。

import {
  DealerPreferenceSubmitSchema,
  DealerPreferenceWithdrawSchema,
  type DealerPreferenceSubmit,
  type DealerPreferenceWithdraw,
} from "@solar/contracts";
import { Prisma } from "@solar/db";
import { revalidatePath } from "next/cache";

import {
  DealerPreferenceClosedError,
  InvalidStateTransitionError,
  NotFoundError,
  TenantIsolationError,
  ValidationError,
} from "@/lib/errors";
import { withServerActionContext } from "@/lib/tenancy/server-action";

import type { TxClient } from "@solar/db";

const LIST_PATH = "/visible-event-candidates";

function preferencePathFor(id: string): string {
  return `${LIST_PATH}/${id}/preference`;
}

interface CandidateRowForGate {
  id: string;
  status: string;
  deadlineAt: Date;
  wholesalerId: string;
}

// 提出/取り下げ前の共通ゲート。
//   - EventCandidate 自体の存在 / status='OPEN' を確認。
//   - relationshipId が同 EventCandidate.wholesalerId 配下かつ
//     EventCandidateVisibility.isVisible=true で結びついていることを確認。
//   - 期限超過なら DealerPreferenceClosedError を throw する責務は呼び出し側
//     (操作種別で許容ポリシーが変わるため — submit は超過 NG、withdraw も超過 NG)。
//
// 戻り値: 候補行 (Date 型の deadlineAt 等を含む) — 呼び出し側で deadline と
// 比較したり、ログに使う。
async function loadCandidateAndAssertVisible(
  tx: TxClient,
  eventCandidateId: string,
  relationshipId: string,
): Promise<CandidateRowForGate> {
  const candidate = await tx.eventCandidate.findUnique({
    where: { id: eventCandidateId },
    select: {
      id: true,
      status: true,
      deadlineAt: true,
      wholesalerId: true,
    },
  });
  if (!candidate) {
    throw new NotFoundError("イベント候補が見つかりません");
  }

  // Visibility 照合 — RLS で relationshipId は既に絞られているが、明示的に
  // 「自社が可視している候補か」を別クエリで確認することで NotFound と 403 を
  // 区別する（可視範囲外なら NotFound、cross-tenant relation 指定なら 403）。
  const visibility = await tx.eventCandidateVisibility.findUnique({
    where: {
      eventCandidateId_relationshipId: {
        eventCandidateId,
        relationshipId,
      },
    },
    select: { isVisible: true },
  });
  if (!visibility || !visibility.isVisible) {
    throw new NotFoundError("このイベント候補は公開されていません");
  }

  return candidate;
}

function assertDeadlineNotPassed(deadlineAt: Date, now: Date): void {
  if (deadlineAt.getTime() <= now.getTime()) {
    throw new DealerPreferenceClosedError(deadlineAt);
  }
}

function assertCandidateOpen(status: string): void {
  if (status !== "OPEN") {
    throw new InvalidStateTransitionError("このイベント候補は希望受付中ではありません", { status });
  }
}

// 入力 relationshipId が ctx 配下かを実体検証。assertCan の requireTenantScope は
// resource.relationshipId 経由で同等のチェックをするが、SaaS-admin bypass で
// 通り抜けるケースがあるため二重防御として ctx.relationshipIds を見る。
function assertRelationshipBelongsToCaller(
  ctx: { relationshipIds: string[]; isSaasAdmin: boolean },
  relationshipId: string,
): void {
  if (ctx.isSaasAdmin) return;
  if (!ctx.relationshipIds.includes(relationshipId)) {
    throw new TenantIsolationError("この二次店関係にアクセスできません", {
      scope: "relationshipId",
    });
  }
}

export interface SubmitPreferenceResult {
  id: string;
  created: boolean;
}

export const submitPreferenceAction = withServerActionContext<
  DealerPreferenceSubmit,
  SubmitPreferenceResult
>(
  {
    action: "dealer_preference.submit",
    resource: ({ input }) => ({ relationshipId: input.relationshipId }),
  },
  async ({ tx, ctx, input }) => {
    const parsed = DealerPreferenceSubmitSchema.parse(input);

    if (!ctx.actorUserId) {
      throw new ValidationError("actor user is required");
    }
    assertRelationshipBelongsToCaller(
      { relationshipIds: ctx.relationshipIds, isSaasAdmin: ctx.isSaasAdmin },
      parsed.relationshipId,
    );

    const candidate = await loadCandidateAndAssertVisible(
      tx,
      parsed.eventCandidateId,
      parsed.relationshipId,
    );
    assertCandidateOpen(candidate.status);
    assertDeadlineNotPassed(candidate.deadlineAt, new Date());

    // upsert — `(eventCandidateId, relationshipId)` UNIQUE。重複提出は更新扱い
    // (F-021 受入基準)。`created` フラグはトーストの文言を出し分けるために
    // 返却する。
    const existing = await tx.dealerPreference.findUnique({
      where: {
        eventCandidateId_relationshipId: {
          eventCandidateId: parsed.eventCandidateId,
          relationshipId: parsed.relationshipId,
        },
      },
      select: { id: true },
    });

    // Json 列 (availableDates) は null を入れるときに `Prisma.JsonNull` を使う
    // 必要がある（プレーン `null` は Prisma の型と噛み合わない）。空配列の場合は
    // JsonNull に丸めて DB 上 NULL にする。
    const availableDatesJson: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      parsed.availableDates && parsed.availableDates.length > 0
        ? (parsed.availableDates.map((d) => d.toISOString()) as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    if (existing) {
      const updated = await tx.dealerPreference.update({
        where: { id: existing.id },
        data: {
          targetMonth: parsed.targetMonth,
          priority: parsed.priority ?? null,
          availableDates: availableDatesJson,
          availablePeople: parsed.staffCount ?? null,
          comment: parsed.note ?? null,
          submittedAt: new Date(),
          submittedBy: ctx.actorUserId,
        },
        select: { id: true },
      });
      revalidatePath(LIST_PATH);
      revalidatePath(preferencePathFor(parsed.eventCandidateId));
      return { id: updated.id, created: false };
    }

    const created = await tx.dealerPreference.create({
      data: {
        eventCandidateId: parsed.eventCandidateId,
        relationshipId: parsed.relationshipId,
        targetMonth: parsed.targetMonth,
        priority: parsed.priority ?? null,
        availableDates: availableDatesJson,
        availablePeople: parsed.staffCount ?? null,
        comment: parsed.note ?? null,
        submittedBy: ctx.actorUserId,
      },
      select: { id: true },
    });
    revalidatePath(LIST_PATH);
    revalidatePath(preferencePathFor(parsed.eventCandidateId));
    return { id: created.id, created: true };
  },
);

export interface WithdrawPreferenceResult {
  ok: true;
}

export const withdrawPreferenceAction = withServerActionContext<
  DealerPreferenceWithdraw,
  WithdrawPreferenceResult
>(
  {
    action: "dealer_preference.withdraw",
    resource: ({ input }) => ({ relationshipId: input.relationshipId }),
  },
  async ({ tx, ctx, input }) => {
    const parsed = DealerPreferenceWithdrawSchema.parse(input);
    assertRelationshipBelongsToCaller(
      { relationshipIds: ctx.relationshipIds, isSaasAdmin: ctx.isSaasAdmin },
      parsed.relationshipId,
    );

    const candidate = await loadCandidateAndAssertVisible(
      tx,
      parsed.eventCandidateId,
      parsed.relationshipId,
    );
    // 取り下げは status='OPEN' かつ deadline 前のみ許可 (docs/05 §4.5 追記済み)。
    // CLOSED 以降は卸業者が集計・配属確定済みで取り下げ不可、期限後も同じ理由で
    // 拒否する。OPEN かつ期限前なら delete。
    assertCandidateOpen(candidate.status);
    assertDeadlineNotPassed(candidate.deadlineAt, new Date());

    // 存在しなければ no-op で 200 を返すか 404 にするかは選択肢。ここでは
    // delete でレコード未存在は noop ではなく 404 として扱う（ユーザは
    // 既存ボタン経由でしか呼べないため、存在しないなら状態ずれ）。
    const existing = await tx.dealerPreference.findUnique({
      where: {
        eventCandidateId_relationshipId: {
          eventCandidateId: parsed.eventCandidateId,
          relationshipId: parsed.relationshipId,
        },
      },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("取り下げ対象の希望が見つかりません");
    }
    await tx.dealerPreference.delete({ where: { id: existing.id } });

    revalidatePath(LIST_PATH);
    revalidatePath(preferencePathFor(parsed.eventCandidateId));
    return { ok: true };
  },
);
