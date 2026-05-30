// Server-side data loader for the wholesaler-side dealer-preference status
// screen (T-03-07 / F-022 / docs/04 §1.3 S-025/S-026 / docs/05 §4.5).
//
// 3-step idiom (auth → assertCan → withTenant)。EventCandidate を取得し、
// その wholesalerId で tenant scope を確認した上で、公開対象 (isVisible=true)
// の二次店関係 と 提出済み DealerPreference を結合する。aggregation は
// `@solar/contracts` の純関数 `summariseDealerPreferences` に委譲する
// (テスト容易性 + 単純化)。
//
// クロステナント / 不存在は等しく NotFoundError で隠蔽（403 と 404 を区別
// しないことで TENANT_ISOLATION のリーク を防ぐ — docs/05 §9.1）。

import "server-only";

import { summariseDealerPreferences } from "@solar/contracts";

import { auth } from "@/auth";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { DealerPreferenceSummary, PreferenceSubmissionStatus } from "@solar/contracts";

export interface EventCandidateHeader {
  id: string;
  wholesalerId: string;
  targetMonth: string;
  scheduledDate: string;
  storeName: string;
  area: string | null;
  address: string | null;
  deadlineAt: string;
  deadlinePassed: boolean;
  status: string;
}

export interface EventCandidatePreferenceStatus {
  candidate: EventCandidateHeader;
  summary: DealerPreferenceSummary;
}

export type { PreferenceSubmissionStatus };

async function requireWholesalerCtxFor(action: "event_candidate.read_preferences") {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
    });
  }
  const ctx = await getTenantContext();
  assertCan({
    user: {
      userId: ctx.actorUserId,
      roles: session.user.roles,
      isSaasAdmin: ctx.isSaasAdmin,
      tenantId: ctx.tenantId,
      wholesalerId: ctx.wholesalerId,
      dealerId: ctx.dealerId,
      relationshipIds: ctx.relationshipIds,
    },
    action,
    // ロール検査だけ先に通し、wholesalerId 一致は本体クエリの後に再検証
    // (cross-tenant の eventCandidateId は RLS で 0 件 → NotFound）。
  });
  return { session, ctx };
}

function toJsonStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * 卸業者画面 (S-025/S-026) 用の集計取得。
 *
 * - `eventCandidateId` で EventCandidate を取得（RLS で他テナント分は 0 件）。
 * - 公開対象 (`EventCandidateVisibility.isVisible=true`) の Relationship を列挙。
 * - 提出済み (`DealerPreference`) を 1:1 結合。
 * - 期限超過判定は server-side で `new Date()` と `deadlineAt` を比較。
 */
export async function getEventCandidatePreferenceStatus(
  eventCandidateId: string,
): Promise<EventCandidatePreferenceStatus> {
  const { ctx } = await requireWholesalerCtxFor("event_candidate.read_preferences");

  return withTenant(ctx, async (tx) => {
    const candidate = await tx.eventCandidate.findUnique({
      where: { id: eventCandidateId },
      select: {
        id: true,
        wholesalerId: true,
        targetMonth: true,
        scheduledDate: true,
        storeName: true,
        address: true,
        area: true,
        deadlineAt: true,
        status: true,
      },
    });
    if (!candidate) {
      // RLS でクロステナント分は invisible なので、ここに到達した時点で
      // 自テナント配下に確実に存在しない or 別テナント = いずれも NotFound 隠蔽。
      throw new NotFoundError("イベント候補が見つかりません");
    }

    // 追加防御: wholesalerId が ctx と一致しないなら NotFound 隠蔽。SaaS-admin
    // 以外なら RLS で既に弾かれるが、SaaS-admin が誤って踏んだ場合のフェイル
    // セーフとして残す（SaaS-admin が当画面を踏む想定は無いが）。
    if (!ctx.isSaasAdmin && ctx.wholesalerId !== candidate.wholesalerId) {
      throw new NotFoundError("イベント候補が見つかりません");
    }

    // 公開対象 (isVisible=true) の visibility 行 + dealer 名を取得。
    const visibilityRows = await tx.eventCandidateVisibility.findMany({
      where: {
        eventCandidateId: candidate.id,
        isVisible: true,
      },
      select: {
        relationshipId: true,
        relationship: {
          select: {
            dealerId: true,
            dealer: { select: { name: true } },
          },
        },
      },
    });

    // 提出済み DealerPreference を取得。relationshipId で結合。
    const preferenceRows =
      visibilityRows.length > 0
        ? await tx.dealerPreference.findMany({
            where: {
              eventCandidateId: candidate.id,
              relationshipId: { in: visibilityRows.map((v) => v.relationshipId) },
            },
            select: {
              id: true,
              relationshipId: true,
              priority: true,
              availableDates: true,
              availablePeople: true,
              comment: true,
              submittedAt: true,
            },
          })
        : [];

    const summary = summariseDealerPreferences({
      visibility: visibilityRows.map((v) => ({
        relationshipId: v.relationshipId,
        dealerId: v.relationship.dealerId,
        dealerName: v.relationship.dealer.name,
      })),
      preferences: preferenceRows.map((p) => ({
        id: p.id,
        relationshipId: p.relationshipId,
        priority: p.priority,
        availableDates: toJsonStringArray(p.availableDates),
        availablePeople: p.availablePeople,
        comment: p.comment,
        submittedAt: p.submittedAt,
      })),
      deadlineAt: candidate.deadlineAt,
      now: new Date(),
    });

    const now = Date.now();
    const header: EventCandidateHeader = {
      id: candidate.id,
      wholesalerId: candidate.wholesalerId,
      targetMonth: candidate.targetMonth,
      scheduledDate: candidate.scheduledDate.toISOString(),
      storeName: candidate.storeName,
      area: candidate.area,
      address: candidate.address,
      deadlineAt: candidate.deadlineAt.toISOString(),
      deadlinePassed: candidate.deadlineAt.getTime() <= now,
      status: candidate.status,
    };

    return { candidate: header, summary };
  });
}
