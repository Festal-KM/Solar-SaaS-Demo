// Server-side data loader for the dealer preference page (S-060 / T-03-06 /
// F-021 / docs/05 §4.5).
//
// 3-step idiom (auth → assertCan → withTenant)。EventCandidate と
// EventCandidateVisibility を joined して visible 範囲を担保した上で、自社の
// 既存 DealerPreference があれば prefill 用に返す。
//
// 戻り値:
//   - candidate: 二次店向け DTO 形に整形 (固定費 / 成果報酬率 / 内部メモなし)
//   - existing : 自社の既存希望 (なければ null)
//   - relationshipId: 当該卸業者との関係 ID (フォーム hidden で submit する)
//
// Cross-tenant / 非可視 / wholesalerId が ctx.relationshipIds から特定できない
// ケースはすべて NotFoundError で隠蔽する（404 にして TENANT_ISOLATION を
// リーク しない）。

import "server-only";

import { auth } from "@/auth";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface PreferenceCandidateView {
  id: string;
  wholesalerId: string;
  wholesalerName: string | null;
  targetMonth: string;
  scheduledDate: string;
  storeName: string;
  address: string | null;
  area: string | null;
  deadlineAt: string;
  deadlinePassed: boolean;
  // EventCandidate.status — page.tsx で 'OPEN' 以外なら formDisabled を立てる。
  status: string;
}

export interface ExistingPreferenceView {
  id: string;
  targetMonth: string;
  priority: number | null;
  availableDates: string[];
  staffCount: number | null;
  note: string | null;
  submittedAt: string;
}

export interface PreferenceLoaderResult {
  candidate: PreferenceCandidateView;
  existing: ExistingPreferenceView | null;
  relationshipId: string;
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
  // dealer_preference.read は wholesaler / dealer 両方 OK だが、本ローダは
  // 二次店向け画面 (S-060) 専用なので dealer roles のみのキーを使うべき。
  // 既存ポリシーで `dealer_preference.submit` が DEALER_ADMIN/STAFF 専用
  // なので read 系もそれに合わせて assertCan は read で実施 (画面読み取りは
  // staff も可)。requireTenantScope=false のため resource 不要。
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
    action: "dealer_preference.read",
  });
  return { session, ctx };
}

function toJsonStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export async function getEventCandidateForPreference(id: string): Promise<PreferenceLoaderResult> {
  const { ctx } = await requireDealerCtx();

  // SaaS-admin 直叩きは画面側で想定外。relationship が無いなら 404 で隠蔽。
  if (!ctx.relationshipIds || ctx.relationshipIds.length === 0) {
    throw new NotFoundError("イベント候補が見つかりません");
  }

  return withTenant(ctx, async (tx) => {
    // Step 1: 候補本体を取得（select で wholesaler-only な列は読まない）。
    const candidate = await tx.eventCandidate.findUnique({
      where: { id },
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
      throw new NotFoundError("イベント候補が見つかりません");
    }

    // Step 2: 自社 relationshipIds の中から「この候補に対する visibility=true」を
    // 検索。候補が DRAFT/CANCELLED でも visibility 行があれば一旦見つかる
    // (= 公開取消は visibility=false で表現)。ここで isVisible=true のみ通す。
    const visibility = await tx.eventCandidateVisibility.findFirst({
      where: {
        eventCandidateId: candidate.id,
        relationshipId: { in: ctx.relationshipIds },
        isVisible: true,
      },
      select: { relationshipId: true },
    });
    if (!visibility) {
      // 公開取消済み or そもそも自社向けに公開されたことが無い → 404 隠蔽。
      throw new NotFoundError("イベント候補が見つかりません");
    }

    // Step 3: wholesaler の表示名を取得。
    const wholesaler = await tx.tenant.findUnique({
      where: { id: candidate.wholesalerId },
      select: { name: true },
    });

    // Step 4: 既存希望（自社分）を prefill 用に取得。
    const existing = await tx.dealerPreference.findUnique({
      where: {
        eventCandidateId_relationshipId: {
          eventCandidateId: candidate.id,
          relationshipId: visibility.relationshipId,
        },
      },
      select: {
        id: true,
        targetMonth: true,
        priority: true,
        availableDates: true,
        availablePeople: true,
        comment: true,
        submittedAt: true,
      },
    });

    const now = Date.now();
    const candidateView: PreferenceCandidateView = {
      id: candidate.id,
      wholesalerId: candidate.wholesalerId,
      wholesalerName: wholesaler?.name ?? null,
      targetMonth: candidate.targetMonth,
      scheduledDate: candidate.scheduledDate.toISOString(),
      storeName: candidate.storeName,
      address: candidate.address,
      area: candidate.area,
      deadlineAt: candidate.deadlineAt.toISOString(),
      deadlinePassed: candidate.deadlineAt.getTime() <= now,
      status: candidate.status,
    };

    const existingView: ExistingPreferenceView | null = existing
      ? {
          id: existing.id,
          targetMonth: existing.targetMonth,
          priority: existing.priority,
          availableDates: toJsonStringArray(existing.availableDates),
          staffCount: existing.availablePeople,
          note: existing.comment,
          submittedAt: existing.submittedAt.toISOString(),
        }
      : null;

    return {
      candidate: candidateView,
      existing: existingView,
      relationshipId: visibility.relationshipId,
    };
  });
}
