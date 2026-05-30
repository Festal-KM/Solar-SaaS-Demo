// `GET /api/event-candidates/visible?targetMonth=YYYY-MM&wholesalerId=...`
// — dealer-side event candidate listing (T-03-05 / F-020 / docs/05 §4.5).
//
// 戻り値は `EventCandidateForDealerDto` の配列 (= fixedFee / performanceRate /
// internalNote を物理除外したシェイプ)。docs/02 §F-020 受入基準で「卸業者の
// 内部情報は二次店向け API で漏れてはならない」と明示されているため、route
// 層では DTO 物理除外と policy 拒否の二重防御を行う:
//
//   1. `assertCan('event_candidate.read_for_dealer')` で DEALER_ADMIN /
//      DEALER_STAFF 以外を 403。wholesaler ロールがこの URL を直叩きしても
//      ここで弾かれる。SaaS-admin は assertCan の早期 return で通るが、
//      `ctx.relationshipIds` が空なので結果は空配列になる。
//   2. データ層は `toEventCandidateDealerDto` で投影。万一上位 DTO に
//      漏らしたとしてもキー自体が消えるため JSON にも乗らない。
//
// 関係終了済み (`Relationship.status='SUSPENDED'`) の卸業者の候補は
// `getTenantContext()` 経由で取得した `ctx.relationshipIds[]` に含まれない
// (where 句で status='ACTIVE' 固定) ため、本ルートに到達した時点で除外済み。

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";

// 相対パスで読み込む — vitest config の path alias は `@/lib` までしか
// 解決しないので、`(dealer)/visible-event-candidates/data` も RSC と route
// で共有する。dealer URL は `/event-candidates` だと wholesaler 側ページ
// (`(wholesaler)/event-candidates/page.tsx`) と Next.js のルート競合を
// 起こすため、二次店ビューは `/visible-event-candidates` に分離。
// (T-03-05 設計メモ — docs/05 §4.5 には URL 衝突回避が未記載のため、本
// task 内で導入した命名規約。API 側のパスは `/api/event-candidates/visible`
// で対称性を維持する。)
import { listVisibleEventCandidatesForDealer } from "../../../(dealer)/visible-event-candidates/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { code: "INVALID_CREDENTIALS", message: "サインインが必要です" },
      { status: 401 },
    );
  }

  let ctx;
  try {
    ctx = await getTenantContext();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: 401 });
    }
    throw err;
  }

  try {
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
  } catch (err) {
    const code = (err as { code?: string }).code ?? "FORBIDDEN";
    const message = (err as Error).message ?? "この情報にアクセスできません";
    return NextResponse.json({ code, message }, { status: 403 });
  }

  const url = new URL(request.url);
  const targetMonthRaw = url.searchParams.get("targetMonth") ?? undefined;
  const wholesalerIdRaw = url.searchParams.get("wholesalerId") ?? undefined;

  if (targetMonthRaw && !TARGET_MONTH_RE.test(targetMonthRaw)) {
    return NextResponse.json(
      { code: "VALIDATION_FAILED", message: "targetMonth は YYYY-MM 形式で指定してください" },
      { status: 400 },
    );
  }

  // 実体ロード — data.ts と同じヘルパに委譲。route ハンドラと RSC が同じ
  // 投影パスを通るため、二次店向け DTO の物理除外ルールが必ず一致する。
  const items = await listVisibleEventCandidatesForDealer({
    ...(targetMonthRaw ? { targetMonth: targetMonthRaw } : {}),
    ...(wholesalerIdRaw ? { wholesalerId: wholesalerIdRaw } : {}),
  });

  return NextResponse.json({ items });
}
