// `assertCan({ user, action, resource })` — RBAC + tenant-scope guard.
//
// Docs/02 §2.1, docs/05 §6.6 §6.10 require every Server Action / Route Handler
// to call this between `getTenantContext()` and `withTenant()`. The current
// matrix is intentionally coarse-grained (SP-01 bootstrap); SP-02+ may
// promote individual actions out of the broad buckets below.
//
// Decision flow:
//   1. SaaS-admin bypass — always allowed (still audited downstream).
//   2. Tenant scope — if the resource carries `wholesalerId` / `dealerId` /
//      `relationshipId`, it must match the caller. On mismatch throw
//      `TenantIsolationError`; the API layer propagates `err.code` as-is so
//      the response carries `code: "TENANT_ISOLATION"` (distinct from a plain
//      role-permission `FORBIDDEN`, per docs/05 §9.1).
//   3. Role × action lookup — the role must appear in the action's allow
//      list. Dealers are blocked outright from financial / gross-profit /
//      incentive-adjust actions.

import { ForbiddenError, TenantIsolationError } from "@/lib/errors";

import type { AppRole } from "@solar/db";

/**
 * Caller identity in a form independent of the Auth.js session shape. Both
 * the full `TenantContext` and a minimal hand-rolled object work as inputs so
 * unit tests don't have to fabricate a session.
 */
export interface PermissionUser {
  userId: string;
  roles: AppRole[];
  isSaasAdmin: boolean;
  tenantId?: string;
  wholesalerId?: string;
  dealerId?: string;
  relationshipIds?: string[];
}

/**
 * Optional tenant-scope hints. `assertCan` matches the strictest available
 * key — if the resource exposes `relationshipId`, only callers whose
 * `relationshipIds` include it pass; otherwise it falls back to
 * `wholesalerId` / `dealerId`. A resource with no scope keys is treated as
 * "non-tenant-scoped" (e.g. a global enum lookup) and only the role check
 * runs.
 */
export interface PermissionResource {
  wholesalerId?: string;
  dealerId?: string;
  relationshipId?: string;
  // Free-form metadata reserved for action-specific checks added in later
  // sprints (e.g. monthlyReportStatus, contractIsCancelled). Kept open here
  // so call sites don't need to widen this interface later.
  [key: string]: unknown;
}

/**
 * Action vocabulary. Strings (not enums) so each domain module can extend the
 * surface without touching this file — `assertCan` looks the string up at
 * runtime. Unknown actions throw `ForbiddenError` so missing matrix entries
 * fail closed.
 */
export type PermissionAction = string;

interface ActionPolicy {
  // Role allow-list. `*` means every authenticated role.
  roles: AppRole[] | "*";
  // When true, the resource MUST carry at least one tenant-scope key and the
  // caller must match it. Defaults to true — the few global actions that
  // genuinely don't scope (e.g. self-profile read) opt out explicitly.
  requireTenantScope?: boolean;
}

const ALL_WHOLESALER_ROLES: AppRole[] = [
  "WHOLESALER_ADMIN",
  "WHOLESALER_EVENT_TEAM",
  "WHOLESALER_CALL_TEAM",
  "WHOLESALER_DIRECT_SALES",
  "WHOLESALER_FIELD_STAFF",
];

const ALL_DEALER_ROLES: AppRole[] = ["DEALER_ADMIN", "DEALER_STAFF"];

// Coarse SP-01 matrix. Extend per-feature in subsequent sprints rather than
// inlining branching here. The key is `<domain>.<verb>`.
const POLICY: Record<PermissionAction, ActionPolicy> = {
  // --- Event candidate management (F-020〜F-024) ---
  //
  // `event_candidate.read` は卸業者側の view（一覧 / 詳細 / 公開トグル等）と
  // 互換性のためレガシーの dealer relationship-scoped read を兼ねている。
  // T-03-05 以降の二次店向け閲覧 (S-059 / `GET /api/event-candidates/visible`)
  // は **必ず** `event_candidate.read_for_dealer` を使うこと — wholesaler-only
  // 用 DTO (`EventCandidateForWholesalerDto`) を二次店が触る経路を、ロール ×
  // アクションのレベルで物理的に潰すため。
  "event_candidate.read": {
    roles: [...ALL_WHOLESALER_ROLES, ...ALL_DEALER_ROLES],
  },
  // T-03-05 / F-020 — 二次店向け候補閲覧 (S-059)。
  //
  // - 許可ロール: DEALER_ADMIN / DEALER_STAFF のみ。wholesaler / saas_admin
  //   が間違ってこのキーを使った場合は 403 (saas_admin は assertCan の早期
  //   return で素通りするが、DTO 切替えは route 側で dealerId 有無を見るので
  //   wholesaler 経路に流れる)。
  // - tenant scope: relationshipIds[] ベースで本体クエリがフィルタする
  //   (`relationshipId IN ctx.relationshipIds`) ため、本ポリシーでは
  //   requireTenantScope=false としてリソース引数を不要にする。実テナント
  //   分離は RLS + クエリ層で多層防御される。
  // - 返却 DTO: `EventCandidateForDealerDto` 限定 (fixedFee / performanceRate /
  //   internalNote を物理除外、docs/02 §F-020 受入基準)。
  "event_candidate.read_for_dealer": {
    roles: ALL_DEALER_ROLES,
    requireTenantScope: false,
  },
  "event_candidate.create": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },
  "event_candidate.update": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },
  "event_candidate.delete": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- Line event management (F-059) — レーンイベント (月単位の複数開催日).
  //
  // 単発の event_candidate と同じロール集合（wholesaler_admin /
  // wholesaler_event_team）。二次店は閲覧不可（メニュー非表示、URL 直叩きは 403）。
  // tenant scope は LineEvent.wholesalerId で確認するため requireTenantScope=true。
  "line_event.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },
  "line_event.create": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },

  // --- Lane preference list (F-060) — 二次店レーン希望一覧 (S-089).
  //
  // 卸業者が、二次店から提出された月次のレーン希望（優先順位付き）を
  // アコーディオンで閲覧する。line_event.read と同じロール集合
  // （wholesaler_admin / wholesaler_event_team）。二次店は他社二次店の希望を
  // 絶対に見てはならないためロールレベルで弾く。tenant scope は
  // LanePreference.wholesalerId で確認するため requireTenantScope=true（既定）。
  "lane_preference.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },

  // --- Dealer preferences (F-025〜F-026) ---
  "dealer_preference.read": {
    roles: [...ALL_WHOLESALER_ROLES, ...ALL_DEALER_ROLES],
  },
  "dealer_preference.submit": {
    roles: ["DEALER_ADMIN", "DEALER_STAFF"],
  },
  // T-03-06 / F-021 — 二次店希望の取り下げ。submit と同じロール集合。期限内なら
  // delete、期限後は 409 をアプリ層で投げる（policy は ロール のみで判定）。
  "dealer_preference.withdraw": {
    roles: ["DEALER_ADMIN", "DEALER_STAFF"],
  },
  // T-03-07 / F-022 — 二次店希望状況確認 (S-025/S-026)。
  //
  // 卸業者本部 (WHOLESALER_ADMIN / WHOLESALER_EVENT_TEAM) のみ。call_team /
  // direct_sales / field_staff は希望集計画面に関与しないため除外。二次店は
  // 他社二次店の提出状況を絶対に見てはならない（docs/02 §F-022 受入基準）ため
  // ロールレベルで弾く。
  // 本ポリシーは EventCandidate の wholesalerId で tenant scope を確認したい
  // ので requireTenantScope=true（既定）。RSC ローダ側で resource に
  // wholesalerId を渡す。
  "event_candidate.read_preferences": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },

  // --- Incentive & gross-profit (F-046〜F-050) — finance, dealers BLOCKED ---
  "incentive.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },
  "incentive.adjust": {
    // F-047 explicit: wholesaler_admin only.
    roles: ["WHOLESALER_ADMIN"],
  },
  "gross_profit.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_DIRECT_SALES"],
  },
  "gross_profit.write": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- Monthly report (F-048〜F-051) ---
  "monthly_report.read": {
    roles: [...ALL_WHOLESALER_ROLES, ...ALL_DEALER_ROLES],
  },
  "monthly_report.submit_comments": {
    roles: ["DEALER_ADMIN"],
  },
  "monthly_report.review": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "monthly_report.finalize": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "monthly_report.unlock": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "monthly_report.run_aggregate": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- Audit log (F-055) ---
  "audit_log.read": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- User / role management (F-006〜F-008) ---
  "user.invite_wholesaler_member": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "user.invite_dealer_member": {
    roles: ["DEALER_ADMIN"],
  },
  // `member.read` — ユーザー一覧閲覧。卸業者は WHOLESALER_ADMIN のみ、二次店は DEALER_ADMIN のみ。
  // requireTenantScope=true — wholesalerId / dealerId でテナント分離を確認。
  "member.read": {
    roles: ["WHOLESALER_ADMIN", "DEALER_ADMIN"],
  },

  // --- Relationship management (F-009 / F-010) ---
  // 関係一覧・スコープ更新・ステータス変更・招待コード発行は WHOLESALER_ADMIN 専用。
  "relationship.read": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "relationship.update": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "relationship.generate_invite_code": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- Self-profile (read-only, no scope key required) ---
  "self.read": {
    roles: "*",
    requireTenantScope: false,
  },

  // --- Event decision (F-023 / T-03-08) — 開催体制決定.
  //
  // `eventDecision.decide` は EventCandidate (status=CLOSED) を DECIDED に遷移し
  // Event + EventDealer + EventChange を生成する。docs/02 §F-023 / docs/04 §S-027。
  // mode=CANCELLED の場合は EventCandidate を CANCELLED にするだけで Event は作らない。
  "event_decision.decide": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },

  // --- Shift management (F-025 / T-03-10) — 自社要員シフト割当.
  //
  // EventShift の create / update / delete は WHOLESALER_ADMIN と
  // WHOLESALER_EVENT_TEAM のみ。現場要員 (field_staff) / 営業 (direct_sales) /
  // コール (call_team) はシフト割当操作を行わない（閲覧も不要）。
  "event.manage_shift": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },

  // --- Event scope override (F-024 / T-03-09) — イベント単位スコープ上書き.
  //
  // EventDealer.scopeOverride を更新する。商談アクション判定 (SP-05) が
  // `DealerScopeService.resolveScope` で参照する。
  // docs/02 §F-024、docs/05 §6.4。
  "event_decision.scope_override": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },

  // --- Venue provider master (F-011) — docs/04 §S-019/§S-020 restricts the
  // master CRUD to wholesaler_admin / wholesaler_event_team. Dealers MUST
  // NOT see this master at all (docs/04 §6.7 keeps contract terms hidden
  // from dealers). Other wholesaler roles (call_team / direct_sales /
  // field_staff) may need a name/area-only lookup for downstream features
  // (e.g. VenueProviderPicker on S-022/S-024); when that need lands, add a
  // separate policy key `venue_provider.pick` (or `venue_provider.read_for_event`)
  // rather than widening `venue_provider.read` here.
  "venue_provider.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },
  "venue_provider.create": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },
  "venue_provider.update": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },

  // --- Venue negotiation (F-017 / T-03-02) — docs/02 §F-017 / docs/04 §S-021
  // §S-022. 場所提供元との対応 (一覧 / 詳細 / 状態遷移 / イベント候補昇格) は
  // wholesaler_admin / wholesaler_event_team のみ。二次店は閲覧不可（メニュー
  // 自体非表示、URL 直叩きは 403）。call_team / direct_sales / field_staff は
  // 業務上、場所取り交渉に関与しないため除外。
  "venue_negotiation.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },
  "venue_negotiation.create": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },
  "venue_negotiation.update": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },

  // --- Product master (F-012) — docs/02 §F-012 / docs/05 §3.3 §4.4.
  //
  // `product.read` is broad: every wholesaler role AND both dealer roles see
  // the catalogue (contracts, dealer-pricing pickers, etc.). `purchasePrice`
  // is the only sensitive field for dealers; it gets stripped at the DTO
  // boundary (docs/03 §4.3 — handled in T-02-04). Here we still allow read
  // so the same Server Action can serve both sides of the API surface.
  //
  // Write paths (create / update / revise / retire) are wholesaler_admin only
  // — price-revisions feed the contract snapshot in SP-05 so they MUST be
  // controlled by the wholesaler's master operator.
  "product.read": {
    roles: [...ALL_WHOLESALER_ROLES, ...ALL_DEALER_ROLES],
  },
  "product.create": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "product.update": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "product.revise": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "product.retire": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- Installer master (F-013) — docs/02 §F-013 / docs/05 §3.3.
  //
  // `installer.read` is intentionally broader than venue_provider.read: 施工業者
  // は契約後の施工状況管理 (SP-05/SP-06) で field_staff / call_team / direct_sales
  // も参照するため、全 wholesaler ロールに開放する。dealer ロールは施工業者
  // マスタへの参照経路を持たない（dealer は契約成立後の施工アサインに関与しない、
  // docs/02 §F-013）ので除外。
  //
  // create / update は wholesaler_admin のみ（マスタ運用責任者）。物理削除は無く、
  // disable も update 権限の派生として扱う（Server Action 側で `installer.update`
  // ポリシーを使う）。
  "installer.read": {
    roles: ALL_WHOLESALER_ROLES,
  },
  "installer.create": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "installer.update": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- Area master (エリアマスタ) — installer と同じ運用ポリシー.
  //
  // `area.read` はイベント候補登録フォームのエリア選択肢として
  // wholesaler_admin / wholesaler_event_team が参照する。dealer ロールは
  // エリアマスタへの参照経路を持たないため除外。
  // create / update は wholesaler_admin のみ（マスタ運用責任者）。物理削除は無く
  // disable も update 権限の派生として扱う。
  "area.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },
  "area.create": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "area.update": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- Store master (店舗マスタ) — area と同じ運用ポリシー.
  //
  // `store.read` はイベント候補登録フォームの店舗選択肢として
  // wholesaler_admin / wholesaler_event_team が参照する。dealer ロールは
  // 店舗マスタへの参照経路を持たないため除外。
  // create / update は wholesaler_admin のみ（マスタ運用責任者）。物理削除は無く
  // disable も update 権限の派生として扱う。
  "store.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM"],
  },
  "store.create": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "store.update": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- Incentive-rate master (F-014) — docs/02 §F-014 / docs/05 §3.3.
  //
  // 関係 (Relationship = wholesaler × dealer) ごとの率マスタ。
  // - read: wholesaler_admin / direct_sales / event_team は卸側で全関係を、
  //         dealer ロールは自社関係分のみを参照する（自社分絞り込みは RLS と
  //         `relationship_id` 引数で担保）。call_team / field_staff は粗利・
  //         インセンティブ関連の数値を扱わないため除外（docs/05 §6.10）。
  // - create / update: WHOLESALER_ADMIN のみ（マスタ運用責任者）。率の変更は
  //   契約スナップショットの基準となるため、運用ユーザに限定する。
  "incentive_rate.read": {
    roles: [
      "WHOLESALER_ADMIN",
      "WHOLESALER_EVENT_TEAM",
      "WHOLESALER_DIRECT_SALES",
      ...ALL_DEALER_ROLES,
    ],
  },
  "incentive_rate.create": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "incentive_rate.update": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- Dealer commission-rate settings (F-049 / S-049) — 手数料設定.
  //
  // 二次店ごとの「トスアップ率 / クロージング率」設定画面。`IncentiveRate`
  // （粗利ベース）とは別概念で、ここは率の直接設定 + 適用期間 + 変更履歴のみ。
  // 設定値そのものが粗利配分に直結するため WHOLESALER_ADMIN 専用とする。
  // requireTenantScope=true — Server Action 側で relationship の所属を
  // withTenant tx 内で確認するため、ここではロール check のみで十分。
  // resource は呼び出し側で wholesalerId を渡せば二重防御になる。
  "commission_setting.read": {
    roles: ["WHOLESALER_ADMIN"],
  },
  "commission_setting.update": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- SaaS-admin tenant management (F-004 / docs/05 §4.3 / T-02-08).
  //
  // 卸業者テナントの作成・閲覧・ステータス変更は SAAS_ADMIN 専用。`assertCan` は
  // saas-admin を最初に return で抜けるので、ここでは形式上 SAAS_ADMIN を allow に
  // 入れておく（明示性のため）。`requireTenantScope: false` — テナント分離は
  // 当然不要（クロステナント操作そのものが業務）。
  "tenant.read": {
    roles: ["SAAS_ADMIN"],
    requireTenantScope: false,
  },
  "tenant.create": {
    roles: ["SAAS_ADMIN"],
    requireTenantScope: false,
  },
  "tenant.update": {
    roles: ["SAAS_ADMIN"],
    requireTenantScope: false,
  },

  // F-005 / T-02-09 — プラン管理。専用キーで切り出して、将来 `tenant.update` を
  // wholesaler_admin に開放（自テナント名の編集等）してもプラン変更だけは
  // SAAS_ADMIN に留められるようにしておく。
  "tenant.update_plan": {
    roles: ["SAAS_ADMIN"],
    requireTenantScope: false,
  },

  // --- Wholesaler settings (F-015 / F-016) — docs/02 §F-015 §F-016 / docs/05 §3.2.
  //
  // 卸業者テナント単位の運用ポリシー設定（キャンセル猶予日数 / 年度開始月 /
  // PII マスキングモード）。
  // - read: 全 wholesaler ロール（年度境界・キャンセル期限は集計/契約画面でも
  //         参照されるため）。dealer ロールは閲覧不可（卸内部の運用設定）。
  // - update: WHOLESALER_ADMIN のみ。設定変更は AuditLog に before/after を
  //   残す（docs/02 §F-055）。
  "wholesaler_settings.read": {
    roles: ALL_WHOLESALER_ROLES,
  },
  "wholesaler_settings.update": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- Masters hub (S-052 / T-02-10) ---
  //
  // 各サブマスタへの入り口画面 (docs/04 §1.3 S-052)。対象ロールは
  // `wholesaler_admin` のみ（マスタ運用責任者）。他の wholesaler ロールは
  // サブマスタ個別画面（場所提供元 / 商品 / 施工業者 等）は role に応じて
  // 直接アクセスできるが、ハブ自体は admin の業務 hub という位置付け。
  // dealer ロールは当然ながら 403。
  "masters.read": {
    roles: ["WHOLESALER_ADMIN"],
  },

  // --- Wholesaler dashboard (S-018 / T-02-11) ---
  //
  // 卸業者ホーム画面 (docs/04 §1.3 S-018)。卸業者全ロール
  // (admin / event_team / call_team / direct_sales / field_staff) で閲覧可。
  // field_staff も自分の関与分のみとはいえ閲覧可（本骨組み版は placeholder
  // のため 0 表示）。dealer ロールは別ダッシュボード (S-058) なので除外。
  "dashboard.read": {
    roles: ALL_WHOLESALER_ROLES,
  },

  // --- Event report submit (F-028 / F-029 / T-04-03) — 開始・終了報告 (S-031/S-056/S-063/S-076).
  //
  // 卸業者全ロールと二次店全ロールが報告可能。現場要員・コールチームも現場で
  // 報告操作を行うことがある。requireTenantScope=false — eventId ベースのアクセス制御は
  // アクション層のイベント所有権確認で担保。
  "event_report.submit": {
    roles: [...ALL_WHOLESALER_ROLES, ...ALL_DEALER_ROLES],
    requireTenantScope: false,
  },

  // --- Own shift read (F-026 / T-03-11) — 自分のシフト確認 (S-053/S-054).
  //
  // `GET /api/me/shifts` — 認証済みユーザが自分の EventShift を取得する。
  // wholesaler_field_staff が主ロールだが、他の卸業者ロールが自分のシフトを
  // 確認するユースケースも存在するため全 wholesaler ロールに開放する。
  // データ層で `userId = session.user.id` を必ず付けるため他人の分は返らない。
  // requireTenantScope=false — userId による自分限定フィルタが tenant 分離を担う。
  "shift.read_own": {
    roles: ALL_WHOLESALER_ROLES,
    requireTenantScope: false,
  },

  // --- Customer management (F-031 / T-04-06) — 顧客登録・編集・一覧 (S-032/S-033/S-057/S-064/S-065).
  //
  // 全営業ロール（卸業者・二次店双方）が顧客を登録・閲覧・編集できる。
  // 二次店は ownerRelationshipId が自テナントの顧客のみ。クエリ層でフィルタ。
  // requireTenantScope=false — wholesalerId / relationshipId はクエリ + RLS で担保。
  "customer.read": {
    roles: [
      "WHOLESALER_ADMIN",
      "WHOLESALER_CALL_TEAM",
      "WHOLESALER_DIRECT_SALES",
      "WHOLESALER_FIELD_STAFF",
      ...ALL_DEALER_ROLES,
    ],
    requireTenantScope: false,
  },
  "customer.create": {
    roles: [
      "WHOLESALER_ADMIN",
      "WHOLESALER_CALL_TEAM",
      "WHOLESALER_DIRECT_SALES",
      "WHOLESALER_FIELD_STAFF",
      ...ALL_DEALER_ROLES,
    ],
    requireTenantScope: false,
  },
  "customer.update": {
    roles: [
      "WHOLESALER_ADMIN",
      "WHOLESALER_CALL_TEAM",
      "WHOLESALER_DIRECT_SALES",
      "WHOLESALER_FIELD_STAFF",
      ...ALL_DEALER_ROLES,
    ],
    requireTenantScope: false,
  },

  // --- Appointment management (F-033 / F-034 / T-04-08) — アポ登録・編集・一覧 (S-034/S-074/S-075).
  //
  // 全営業ロール (卸業者・二次店双方) がアポを登録・閲覧・編集できる。
  // 二次店は acquiredRelationshipId が自テナントのアポのみ参照する。
  // requireTenantScope=false — wholesalerId / relationshipId はクエリ + RLS で担保。
  "appointment.read": {
    roles: [
      "WHOLESALER_ADMIN",
      "WHOLESALER_CALL_TEAM",
      "WHOLESALER_DIRECT_SALES",
      "WHOLESALER_FIELD_STAFF",
      ...ALL_DEALER_ROLES,
    ],
    requireTenantScope: false,
  },
  "appointment.create": {
    roles: [
      "WHOLESALER_ADMIN",
      "WHOLESALER_CALL_TEAM",
      "WHOLESALER_DIRECT_SALES",
      "WHOLESALER_FIELD_STAFF",
      ...ALL_DEALER_ROLES,
    ],
    requireTenantScope: false,
  },
  "appointment.update": {
    roles: [
      "WHOLESALER_ADMIN",
      "WHOLESALER_CALL_TEAM",
      "WHOLESALER_DIRECT_SALES",
      "WHOLESALER_FIELD_STAFF",
      ...ALL_DEALER_ROLES,
    ],
    requireTenantScope: false,
  },
  "appointment.cancel": {
    roles: [
      "WHOLESALER_ADMIN",
      "WHOLESALER_CALL_TEAM",
      "WHOLESALER_DIRECT_SALES",
      ...ALL_DEALER_ROLES,
    ],
    requireTenantScope: false,
  },

  // --- Quick appointment (F-031 / F-033 / T-04-11) — 現場フォームでの顧客 + アポ同時登録 (S-057).
  //
  // wholesaler_field_staff が催事現場でスマホから 1 画面で Customer + Appointment を
  // 同時作成するショートカット。既存の customer.create / appointment.create と同一の
  // DB 操作だが、1 トランザクションで 2 つのリソースを生成するため専用アクションキーを用意する。
  // requireTenantScope=false — wholesalerId は ctx から取得し、クエリ + RLS で担保。
  "quick_appointment.create": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_FIELD_STAFF"],
    requireTenantScope: false,
  },

  // --- Pre-call management (F-035 / T-04-09) — マエカク管理 (S-035).
  //
  // `pre_call.record` — コール結果を記録し、Appointment.status を自動更新する。
  // WHOLESALER_ADMIN と WHOLESALER_CALL_TEAM のみ許可。二次店ロールは 403。
  // requireTenantScope=false — appointmentId ベースのアクセス制御はアクション層で担保。
  "pre_call.record": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_CALL_TEAM"],
    requireTenantScope: false,
  },
  // `pre_call.read` — マエカク履歴閲覧。二次店ロールは閲覧不可（docs/02 §F-035 受入基準）。
  "pre_call.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_CALL_TEAM", "WHOLESALER_DIRECT_SALES"],
    requireTenantScope: false,
  },

  // --- Pre-call notification (F-036 / F-037 / T-04-10) — マエカク結果連絡・二次店確認.
  //
  // `pre_call_notification.send` — 卸業者側がマエカク結果を対象二次店に連絡する。
  // WHOLESALER_ADMIN と WHOLESALER_CALL_TEAM のみ許可。
  // requireTenantScope=false — preCallId ベースのアクセス制御はアクション層で担保。
  "pre_call_notification.send": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_CALL_TEAM"],
    requireTenantScope: false,
  },
  // `pre_call_notification.acknowledge` — 二次店側が通知を確認済みにする。
  // DEALER_ADMIN と DEALER_STAFF のみ許可。
  // requireTenantScope=false — notificationId の関係 ID を DB から取得して照合する。
  "pre_call_notification.acknowledge": {
    roles: ["DEALER_ADMIN", "DEALER_STAFF"],
    requireTenantScope: false,
  },

  // --- Event read (F-027 / T-04-02) — 配属済みイベント一覧・詳細 (S-029/S-030/S-061/S-062).
  //
  // 卸業者は全ロールで自社テナントのイベントを閲覧可（wholesalerId スコープで制限）。
  // 二次店は自社が担当する EventDealer.relationshipId IN ctx.relationshipIds のもの
  // のみ。クエリ層でフィルタするため requireTenantScope=false。
  "event.read": {
    roles: [...ALL_WHOLESALER_ROLES, ...ALL_DEALER_ROLES],
    requireTenantScope: false,
  },

  // --- Deal management (F-038 / T-05-03) — 商談・クロージング管理 (S-037/S-038/S-067).
  //
  // 卸業者の DIRECT_SALES と WHOLESALER_ADMIN が主担当。DEALER_ADMIN / DEALER_STAFF
  // はスコープ判定（canDealerCloseDeal）がアクション層で行われるため、ロールレベルでは
  // 全二次店ロールを通過させる。スコープ APPOINTMENT_ONLY は create/update で 403。
  // requireTenantScope=false — wholesalerId / relationshipId はクエリ + RLS で担保。
  "deal.read": {
    roles: [
      "WHOLESALER_ADMIN",
      "WHOLESALER_DIRECT_SALES",
      "WHOLESALER_CALL_TEAM",
      ...ALL_DEALER_ROLES,
    ],
    requireTenantScope: false,
  },
  "deal.create": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_DIRECT_SALES", ...ALL_DEALER_ROLES],
    requireTenantScope: false,
  },
  "deal.update": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_DIRECT_SALES", ...ALL_DEALER_ROLES],
    requireTenantScope: false,
  },

  // --- Contract management (F-040 / T-05-06) — 契約登録 (S-040 / S-041).
  //
  // docs/02 §F-040: 契約登録は WHOLESALER_ADMIN と WHOLESALER_DIRECT_SALES のみ。
  // 二次店ロールは (FULL_CLOSING スコープでも) contract.create をコールしない —
  // 卸業者が商談クロージング後に自社で登録する設計 (docs/05 §4.8)。
  // requireTenantScope=false — wholesalerId / dealId はアクション層で ctx から取得。
  "contract.create": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_DIRECT_SALES"],
    requireTenantScope: false,
  },

  // --- Contract item replacement (F-041 / T-05-07) — 契約明細登録 (S-044).
  //
  // 契約明細の全置換。contractItem.replace は contract.create と同じロール集合。
  // ACTIVE 契約のみ許可（アクション層で status チェック）。
  // requireTenantScope=false — contractId の所属は withTenant tx 内で担保。
  "contract.update": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_DIRECT_SALES"],
    requireTenantScope: false,
  },

  // --- Contract cancellation (F-043 / T-06-04) — 契約キャンセル (S-041).
  //
  // docs/02 §F-043 + CLAUDE.md rule #7: WHOLESALER_ADMIN 専用。
  // 期限内 / 期限後の分岐はアクション層で行う。ロールレベルでは admin のみ。
  // requireTenantScope=false — contractId の所属は withTenant tx 内で担保。
  "contract.cancel": {
    roles: ["WHOLESALER_ADMIN"],
    requireTenantScope: false,
  },

  // --- Contract read (F-040 / T-05-09) — 契約一覧・詳細 (S-040 / S-041 / S-065).
  //
  // 卸業者全ロールは自テナントの全契約を閲覧可。二次店は ownerRelationshipId が
  // 自テナントの関係に属する契約のみ（クエリ層でフィルタ）。
  // requireTenantScope=false — wholesalerId / relationshipId はクエリ + RLS で担保。
  "contract.read": {
    roles: [...ALL_WHOLESALER_ROLES, ...ALL_DEALER_ROLES],
    requireTenantScope: false,
  },

  // --- Construction management (F-044 / T-05-10) — 施工状況管理 (S-046).
  //
  // 施工レコードの作成・更新・ステータス変更は WHOLESALER_ADMIN と
  // WHOLESALER_DIRECT_SALES のみ。docs/02 §F-044。
  // requireTenantScope=false — contractId の所属は withTenant tx 内で担保。
  "construction.manage": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_DIRECT_SALES"],
    requireTenantScope: false,
  },
  "construction.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_DIRECT_SALES"],
    requireTenantScope: false,
  },

  // --- Application management (F-045 / T-05-11) — 補助金申請管理 (S-047).
  //
  // 補助金申請レコードの作成・更新・ステータス変更は WHOLESALER_ADMIN と
  // WHOLESALER_DIRECT_SALES のみ。docs/02 §F-045。
  // requireTenantScope=false — contractId の所属は withTenant tx 内で担保。
  "application.manage": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_DIRECT_SALES"],
    requireTenantScope: false,
  },
  "application.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_DIRECT_SALES"],
    requireTenantScope: false,
  },

  // --- Notification read / mark-read (F-052 / T-07-04) — インボックス (S-078/S-079).
  //
  // すべての認証済みロールが自分宛の通知を閲覧・既読更新できる。
  // データ層で `recipientUserId = ctx.actorUserId` を必ず付けるため他人の通知は返らない。
  // requireTenantScope=false — userId フィルタが分離を担保する。
  "notification.read": {
    roles: "*",
    requireTenantScope: false,
  },
  "notification.mark_read": {
    roles: "*",
    requireTenantScope: false,
  },
  // `notification.update_preferences` — per-user channel × type ON/OFF設定 (S-080 / T-07-06).
  // 全認証済みロールが自分のプリファレンスを更新できる。userId は ctx から取るため
  // requireTenantScope=false。
  "notification.update_preferences": {
    roles: "*",
    requireTenantScope: false,
  },

  // --- Dealer performance read (F-051 / T-06-10) — 二次店向け成績確認 (S-069).
  //
  // 二次店が自社 relationship の月次成績（契約数・売上・インセンティブ）を確認する。
  // 仕入値は DTO 層で物理除外 (CLAUDE.md rule #5)。他社二次店の数値は RLS +
  // クエリ層で隔離される。requireTenantScope=false — relationshipIds はクエリ層で担保。
  "dealer_performance.read": {
    roles: ALL_DEALER_ROLES,
    requireTenantScope: false,
  },

  // --- Dealer incentive read (F-051 / T-06-10) — 二次店向けインセンティブ確認 (S-070).
  //
  // 二次店が自社の確定済み (FINALIZED) インセンティブを確認する。
  // targetProfit (インセンティブ対象粗利) および rate / amount のみ返し、
  // purchasePrice 等の仕入値は含まない。requireTenantScope=false — 同上。
  "dealer_incentive.read": {
    roles: ALL_DEALER_ROLES,
    requireTenantScope: false,
  },

  // --- BI dashboard (F-056 / T-06-11) — BI ダッシュボード (S-051).
  //
  // 売上・粗利・契約数の時系列集計と二次店ランキング。
  // docs/02 §F-056 / docs/04 §S-051: wholesaler_admin / wholesaler_event_team /
  // wholesaler_direct_sales のみ。dealer ロールは他社情報混入を防ぐため禁止。
  // wholesaler scope は withTenant の RLS + ctx.wholesalerId で担保するため
  // requireTenantScope=true + resource に wholesalerId を渡す。
  "bi.read": {
    roles: ["WHOLESALER_ADMIN", "WHOLESALER_EVENT_TEAM", "WHOLESALER_DIRECT_SALES"],
  },
};

export interface AssertCanInput {
  user: PermissionUser;
  action: PermissionAction;
  resource?: PermissionResource;
}

export function assertCan(input: AssertCanInput): void {
  const { user, action, resource } = input;

  if (user.isSaasAdmin) return;

  const policy = POLICY[action];
  if (!policy) {
    // Fail closed — an unknown action means the matrix wasn't extended for
    // this Server Action yet. Better to 403 than to silently allow.
    throw new ForbiddenError("未定義のアクションです", { action });
  }

  if (policy.roles !== "*") {
    const hasRole = user.roles.some((r) => (policy.roles as AppRole[]).includes(r));
    if (!hasRole) {
      throw new ForbiddenError("この操作を実行する権限がありません", {
        action,
        actorRoles: user.roles,
      });
    }
  }

  const requireScope = policy.requireTenantScope ?? true;
  if (requireScope && resource) {
    assertTenantScopeMatch(user, resource, action);
  }
}

function assertTenantScopeMatch(
  user: PermissionUser,
  resource: PermissionResource,
  action: PermissionAction,
): void {
  // relationshipId is the strictest key — if present it pinpoints a single
  // (wholesaler, dealer) pair. The caller passes only when the id appears in
  // their `relationshipIds`.
  if (resource.relationshipId) {
    const relIds = user.relationshipIds ?? [];
    if (!relIds.includes(resource.relationshipId)) {
      throw new TenantIsolationError("この情報にアクセスできません", {
        action,
        scope: "relationshipId",
      });
    }
    return;
  }

  if (resource.wholesalerId) {
    if (user.wholesalerId !== resource.wholesalerId) {
      throw new TenantIsolationError("この情報にアクセスできません", {
        action,
        scope: "wholesalerId",
      });
    }
    return;
  }

  if (resource.dealerId) {
    if (user.dealerId !== resource.dealerId) {
      throw new TenantIsolationError("この情報にアクセスできません", {
        action,
        scope: "dealerId",
      });
    }
    return;
  }

  // No scope keys on the resource — treat as scope-less and rely on the role
  // check that already succeeded above.
}
