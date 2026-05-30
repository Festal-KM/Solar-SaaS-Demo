// `GET /api/dealer-preferences?eventCandidateId=...`
// — wholesaler-side dealer-preference status (T-03-07 / F-022 /
// docs/04 §1.3 S-025/S-026 / docs/05 §4.5).
//
// 卸業者本部 (WHOLESALER_ADMIN / WHOLESALER_EVENT_TEAM) のみ。dealer ロールは
// `assertCan('event_candidate.read_preferences')` で 403。クロステナントの
// eventCandidateId は RLS で invisible → NotFound 隠蔽（TENANT_ISOLATION を
// リークしない、docs/05 §9.1）。
//
// レスポンス shape:
//   {
//     candidate: { id, targetMonth, scheduledDate, storeName, ... },
//     summary: { rows: [...], totals: { visible, submitted, pending, overdue } }
//   }
//
// 集計ロジック自体は packages/contracts の純関数
// `summariseDealerPreferences` に切り出し済み（テスト容易性 + 単純化）。

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";

// 相対パスで読み込む — vitest config の path alias は `@/lib` までしか
// 解決しないので、(wholesaler)/event-detail/[id]/preferences/data も RSC と
// route で共有する。
import { getEventCandidatePreferenceStatus } from "../../(wholesaler)/event-detail/[id]/preferences/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { code: "INVALID_CREDENTIALS", message: "サインインが必要です" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const eventCandidateId = url.searchParams.get("eventCandidateId");
  if (!eventCandidateId) {
    return NextResponse.json(
      { code: "VALIDATION_FAILED", message: "eventCandidateId を指定してください" },
      { status: 400 },
    );
  }

  try {
    const data = await getEventCandidatePreferenceStatus(eventCandidateId);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: 401 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: 404 });
    }
    // ForbiddenError / TenantIsolationError は AppError 系で httpStatus / code を持つ。
    const e = err as { code?: string; httpStatus?: number; message?: string };
    if (typeof e.httpStatus === "number" && typeof e.code === "string") {
      return NextResponse.json(
        { code: e.code, message: e.message ?? "エラーが発生しました" },
        { status: e.httpStatus },
      );
    }
    throw err;
  }
}
