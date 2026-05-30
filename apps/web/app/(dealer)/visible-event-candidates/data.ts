// Server-side data loader for the dealer-facing event candidate list
// (T-03-05 / F-020 / docs/04 §1.5 S-059 / docs/05 §4.5).
//
// Three-step idiom (auth → assertCan → withTenant) identical to the
// wholesaler-side loaders, with one difference: the projection runs through
// `toEventCandidateDealerDto` so the response physically lacks `fixedFee`,
// `performanceRate` and `internalNote`. docs/02 §F-020 受入基準 forbids those
// three keys from ever appearing in dealer-visible payloads.
//
// Visibility resolution:
//   1. `getTenantContext()` 経由で `ctx.relationshipIds[]` (自社が ACTIVE な
//      Relationship 群) を取得。SET LOCAL でセッション側 RLS も自動付与される。
//   2. `EventCandidateVisibility` で `isVisible=true` かつ
//      `relationshipId IN ctx.relationshipIds` の組合せが「公開中」の定義。
//   3. 上記 visibility に紐づく `EventCandidate` で `status='OPEN'` のみを
//      公開対象とする (DRAFT / CLOSED / DECIDED / CANCELLED は除外)。
//   4. オプションの `wholesalerId` フィルタが指定された場合は、自社が
//      `wholesalerId` の Relationship を持つ場合のみ通す（保有しないなら
//      空配列）。
//
// Relationship.status='SUSPENDED' は ctx.relationshipIds から既に除外されて
// いる (`getTenantContext` の where 句で `status:'ACTIVE'` 固定) ため、本
// loader で重複チェックは不要。docs/01 §9 のビジネスルール「関係終了済み
// 卸業者の候補は二次店から見えない」はこの経路で担保される。

import "server-only";

import { toEventCandidateDealerDto } from "@solar/contracts";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import type { EventCandidateForDealerDto } from "@solar/contracts";

export interface DealerEventCandidateListItem extends EventCandidateForDealerDto {
  // Joined display labels — the dealer view sorts/groups by these in the UI.
  // 卸業者名はマルチ卸業者と取引している二次店向けのフィルタにも使う。
  wholesalerName: string | null;
}

export interface ListVisibleFilter {
  targetMonth?: string;
  wholesalerId?: string;
}

async function requireDealerCtx() {
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
    action: "event_candidate.read_for_dealer",
  });
  return { session, ctx };
}

function isValidTargetMonth(value: string | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * 二次店ロールが自社関係配下の公開中イベント候補を一覧取得する。
 *
 * - 戻り値の DTO は `EventCandidateForDealerDto` (= fixedFee / performanceRate /
 *   internalNote を物理除外) に joined `wholesalerName` を付与した形。
 * - 二次店が複数卸業者と取引している場合は `wholesalerId` フィルタを使う。
 *   未指定なら全卸業者の公開候補を返す。
 * - SaaS-admin が誤って呼んでも `assertCan('event_candidate.read_for_dealer')`
 *   は SaaS-admin bypass で通るが、`ctx.relationshipIds` が空のため結果は
 *   空配列になる（運用上 SaaS-admin が dealer 画面を踏むことは想定外）。
 */
export async function listVisibleEventCandidatesForDealer(
  filter: ListVisibleFilter = {},
): Promise<DealerEventCandidateListItem[]> {
  const { ctx } = await requireDealerCtx();

  // Dealer ロールで relationshipIds が空 = どの卸業者とも ACTIVE な関係が無い。
  // 早期 return することで EventCandidate スキャンを発生させない（RLS でも
  // 同じ結果になるが、明示的に短絡してログに残す）。
  if (!ctx.isSaasAdmin && (!ctx.relationshipIds || ctx.relationshipIds.length === 0)) {
    return [];
  }

  return withTenant(ctx, async (tx) => {
    // Step 1: 自社の visibility 行を取得（isVisible=true のみ）。
    //   relationshipId IN ctx.relationshipIds は RLS でも保証されるが、明示的に
    //   where に置くことでクエリプランナがインデックス
    //   `EventCandidateVisibility @@index([relationshipId, isVisible])` を確実に
    //   使えるようにする。
    const visibilities = await tx.eventCandidateVisibility.findMany({
      where: {
        isVisible: true,
        ...(ctx.relationshipIds && ctx.relationshipIds.length > 0
          ? { relationshipId: { in: ctx.relationshipIds } }
          : {}),
      },
      select: { eventCandidateId: true },
    });
    if (visibilities.length === 0) return [];
    const candidateIds = Array.from(new Set(visibilities.map((v) => v.eventCandidateId)));

    // Step 2: EventCandidate を OPEN ステータスでフィルタしつつ取得。
    //   `select` で wholesaler-only な fixedFee / performanceRate / internalNote
    //   を **そもそも DB から読まない**（深い意味では DTO 物理除外と二重防御）。
    const rows = await tx.eventCandidate.findMany({
      where: {
        id: { in: candidateIds },
        status: "OPEN",
        ...(isValidTargetMonth(filter.targetMonth) ? { targetMonth: filter.targetMonth } : {}),
        ...(filter.wholesalerId ? { wholesalerId: filter.wholesalerId } : {}),
      },
      orderBy: [{ targetMonth: "asc" }, { scheduledDate: "asc" }],
      select: {
        id: true,
        wholesalerId: true,
        venueProviderId: true,
        venueNegotiationId: true,
        targetMonth: true,
        scheduledDate: true,
        storeName: true,
        address: true,
        area: true,
        deadlineAt: true,
        contractType: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (rows.length === 0) return [];

    // Step 3: wholesaler の表示名 (Tenant.name) をまとめて引いて結合。
    //   EventCandidate.wholesalerId は Tenant への relation を持たないので
    //   別クエリで読む（venue-provider と同じパターン）。
    const wholesalerIds = Array.from(new Set(rows.map((r) => r.wholesalerId)));
    const wholesalers = await tx.tenant.findMany({
      where: { id: { in: wholesalerIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(wholesalers.map((w) => [w.id, w.name]));

    return rows.map<DealerEventCandidateListItem>((r) => {
      // `toEventCandidateDealerDto` を介して DTO の物理除外を担保する。
      // wholesaler-only な 3 フィールドはそもそも select に含めていないため
      // ここで undefined を渡すと型エラーになる — DealerDto は Omit 結果
      // なのでキーごと存在しない設計。
      const dto = toEventCandidateDealerDto({
        id: r.id,
        wholesalerId: r.wholesalerId,
        venueProviderId: r.venueProviderId,
        venueNegotiationId: r.venueNegotiationId,
        targetMonth: r.targetMonth,
        scheduledDate: r.scheduledDate.toISOString(),
        storeName: r.storeName,
        address: r.address,
        area: r.area,
        deadlineAt: r.deadlineAt.toISOString(),
        contractType: r.contractType,
        // wholesaler-only な 3 フィールドは select していないため、
        // EventCandidateForWholesalerDto の型を満たすために null を渡す。
        // `toEventCandidateDealerDto` がキーごと物理削除するため、出力
        // (dto) には絶対に現れない。
        fixedFee: null,
        performanceRate: null,
        internalNote: null,
        contractNote: null,
        status: r.status,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      });
      return {
        ...dto,
        wholesalerName: nameById.get(r.wholesalerId) ?? null,
      };
    });
  });
}

// 二次店が取引している ACTIVE な卸業者の一覧 (画面フィルタ用)。
// 1 件しかなければ「卸業者で絞り込み」UI を出さない、という条件分岐に使う。
export interface ActiveWholesalerOption {
  id: string;
  name: string;
}

export async function listActiveWholesalersForDealer(): Promise<ActiveWholesalerOption[]> {
  const { ctx } = await requireDealerCtx();
  if (!ctx.isSaasAdmin && (!ctx.relationshipIds || ctx.relationshipIds.length === 0)) {
    return [];
  }
  return withTenant(ctx, async (tx) => {
    const rels = await tx.relationship.findMany({
      where: {
        status: "ACTIVE",
        ...(ctx.relationshipIds && ctx.relationshipIds.length > 0
          ? { id: { in: ctx.relationshipIds } }
          : {}),
      },
      select: { wholesalerId: true },
    });
    const wholesalerIds = Array.from(new Set(rels.map((r) => r.wholesalerId)));
    if (wholesalerIds.length === 0) return [];
    const wholesalers = await tx.tenant.findMany({
      where: { id: { in: wholesalerIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return wholesalers.map((w) => ({ id: w.id, name: w.name }));
  });
}
