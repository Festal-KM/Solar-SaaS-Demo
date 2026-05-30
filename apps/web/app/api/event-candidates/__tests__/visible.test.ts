// Integration tests for `GET /api/event-candidates/visible` (T-03-05 /
// F-020 / docs/05 §4.5).
//
// The route is the documented leak path for the wholesaler's `internalNote` /
// `fixedFee` / `performanceRate`. docs/02 §F-020 受入基準 forbids those keys
// from appearing in any dealer-visible payload. The integration test exercises
// the masking + relationship scoping + status filter + role gate with mocked
// session + DB:
//
//   1. dealer_admin: 自社関係配下の OPEN 候補のみ見える + 卸業者の内部 3 キー
//      が物理除外されていることを確認。
//   2. dealer_staff: 他社二次店関係の候補が見えないことを確認。
//   3. DRAFT / CLOSED / CANCELLED の候補は除外されることを確認 (status=OPEN
//      のみが公開対象、docs/05 §4.5)。
//   4. Relationship.status=SUSPENDED で関係終了済みの候補は ctx.relationshipIds
//      から除外されているため、結果に出ない。
//   5. wholesaler ロール (WHOLESALER_ADMIN) は 403。
//   6. wholesalerId クエリ指定で当該卸業者の候補のみに絞り込まれる。

import { beforeEach, describe, expect, it, vi } from "vitest";

// data.ts (RSC ローダ) は `server-only` を import するため、vitest では
// no-op stub が無いと `Failed to load url server-only` で落ちる。
vi.mock("server-only", () => ({}));

const authMock = vi.fn();
const getTenantContextMock = vi.fn();
const withTenantMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/tenancy/context", () => ({
  getTenantContext: () => getTenantContextMock(),
}));

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant: <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> =>
    withTenantMock(_ctx, fn),
}));

const { GET } = await import("../visible/route.js");

// 共通フィクスチャ。OPEN 候補 2 件 (rel_a 配下 1 + rel_b 配下 1) を、
// 卸業者 ws_a の wholesalerId で発行する。SUSPENDED / DRAFT / CLOSED 等の
// 不可視ケースは withTenant 内の tx mock 側で「visibility 行を返さない」「row が
// status mismatch で除外される」形にして再現する。
function makeRequest(query?: string): Request {
  const url = query
    ? `http://localhost/api/event-candidates/visible?${query}`
    : "http://localhost/api/event-candidates/visible";
  return new Request(url, { method: "GET" });
}

const DEALER_ALPHA_SESSION = {
  user: {
    id: "u_dl_alpha_admin",
    tenantId: "tenant_dl_alpha",
    tenantType: "DEALER",
    wholesalerId: "tenant_ws_a",
    dealerId: "tenant_dl_alpha",
    roles: ["DEALER_ADMIN"],
    isSaasAdmin: false,
  },
};

const DEALER_ALPHA_CTX = {
  actorUserId: "u_dl_alpha_admin",
  tenantId: "tenant_dl_alpha",
  dealerId: "tenant_dl_alpha",
  wholesalerId: "tenant_ws_a",
  // 自社が ACTIVE な Relationship は rel_a_alpha のみ。rel_b_alpha は SUSPENDED
  // なので getTenantContext で既に除外されている、という前提で fixture を作る。
  relationshipIds: ["rel_a_alpha"],
  isSaasAdmin: false,
};

interface TxFixture {
  visibilityRows: Array<{
    eventCandidateId: string;
    relationshipId: string;
    isVisible: boolean;
  }>;
  candidateRows: Array<{
    id: string;
    wholesalerId: string;
    venueProviderId: string | null;
    venueNegotiationId: string | null;
    targetMonth: string;
    scheduledDate: Date;
    storeName: string;
    address: string | null;
    area: string | null;
    deadlineAt: Date;
    contractType: "FIXED" | "PERFORMANCE" | "OTHER" | null;
    status: "DRAFT" | "OPEN" | "CLOSED" | "DECIDED" | "CANCELLED";
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  tenantRows: Array<{ id: string; name: string }>;
}

function installTx(fixture: TxFixture): void {
  withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
    const tx = {
      eventCandidateVisibility: {
        findMany: vi
          .fn()
          .mockImplementation(
            async (args: { where: { isVisible: boolean; relationshipId?: { in: string[] } } }) => {
              return fixture.visibilityRows.filter((v) => {
                if (v.isVisible !== args.where.isVisible) return false;
                if (args.where.relationshipId?.in) {
                  return args.where.relationshipId.in.includes(v.relationshipId);
                }
                return true;
              });
            },
          ),
      },
      eventCandidate: {
        findMany: vi.fn().mockImplementation(
          async (args: {
            where: {
              id?: { in: string[] };
              status?: string;
              targetMonth?: string;
              wholesalerId?: string;
            };
          }) => {
            return fixture.candidateRows.filter((r) => {
              if (args.where.id?.in && !args.where.id.in.includes(r.id)) return false;
              if (args.where.status && r.status !== args.where.status) return false;
              if (args.where.targetMonth && r.targetMonth !== args.where.targetMonth) return false;
              if (args.where.wholesalerId && r.wholesalerId !== args.where.wholesalerId)
                return false;
              return true;
            });
          },
        ),
      },
      tenant: {
        findMany: vi.fn().mockImplementation(async (args: { where: { id: { in: string[] } } }) => {
          return fixture.tenantRows.filter((t) => args.where.id.in.includes(t.id));
        }),
      },
      relationship: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    return fn(tx);
  });
}

beforeEach(() => {
  authMock.mockReset();
  getTenantContextMock.mockReset();
  withTenantMock.mockReset();
});

describe("GET /api/event-candidates/visible", () => {
  it("dealer_admin: returns OPEN candidates visible to own relationship, with internalNote/fixedFee/performanceRate keys physically absent", async () => {
    authMock.mockResolvedValue(DEALER_ALPHA_SESSION);
    getTenantContextMock.mockResolvedValue(DEALER_ALPHA_CTX);
    installTx({
      visibilityRows: [
        { eventCandidateId: "ec_open_1", relationshipId: "rel_a_alpha", isVisible: true },
      ],
      candidateRows: [
        {
          id: "ec_open_1",
          wholesalerId: "tenant_ws_a",
          venueProviderId: "vp_1",
          venueNegotiationId: null,
          targetMonth: "2026-07",
          scheduledDate: new Date("2026-07-15T09:00:00Z"),
          storeName: "イオン横浜",
          address: "横浜市中区",
          area: "神奈川",
          deadlineAt: new Date("2026-07-01T09:00:00Z"),
          contractType: "FIXED",
          status: "OPEN",
          publishedAt: new Date("2026-06-01T00:00:00Z"),
          createdAt: new Date("2026-05-25T00:00:00Z"),
          updatedAt: new Date("2026-05-25T00:00:00Z"),
        },
      ],
      tenantRows: [{ id: "tenant_ws_a", name: "パイロット卸 株式会社" }],
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    const row = body.items[0]!;

    // 卸業者内部 3 キーは絶対に存在してはならない。`undefined` でも `null`
    // でもなく、Object.keys にも現れない（DTO 物理除外）。
    expect(Object.keys(row).includes("fixedFee")).toBe(false);
    expect(Object.keys(row).includes("performanceRate")).toBe(false);
    expect(Object.keys(row).includes("internalNote")).toBe(false);

    // 二次店が必要とする業務情報は残る (場所・日にち・回答期限など)。
    expect(row.id).toBe("ec_open_1");
    expect(row.storeName).toBe("イオン横浜");
    expect(row.targetMonth).toBe("2026-07");
    expect(row.wholesalerName).toBe("パイロット卸 株式会社");
  });

  it("dealer_staff: candidates wired to a different relationship are invisible", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "u_dl_alpha_staff",
        tenantId: "tenant_dl_alpha",
        tenantType: "DEALER",
        wholesalerId: "tenant_ws_a",
        dealerId: "tenant_dl_alpha",
        roles: ["DEALER_STAFF"],
        isSaasAdmin: false,
      },
    });
    getTenantContextMock.mockResolvedValue(DEALER_ALPHA_CTX);
    installTx({
      // visibility は rel_b_beta (= 他社二次店の関係) のみ。dealer_alpha の
      // ctx.relationshipIds=[rel_a_alpha] には含まれないので、findMany の
      // where.relationshipId.in フィルタで 0 件になる。
      visibilityRows: [
        { eventCandidateId: "ec_open_other", relationshipId: "rel_b_beta", isVisible: true },
      ],
      candidateRows: [
        {
          id: "ec_open_other",
          wholesalerId: "tenant_ws_a",
          venueProviderId: null,
          venueNegotiationId: null,
          targetMonth: "2026-07",
          scheduledDate: new Date("2026-07-20T09:00:00Z"),
          storeName: "他社向け店舗",
          address: null,
          area: null,
          deadlineAt: new Date("2026-07-10T09:00:00Z"),
          contractType: null,
          status: "OPEN",
          publishedAt: new Date("2026-06-01T00:00:00Z"),
          createdAt: new Date("2026-05-25T00:00:00Z"),
          updatedAt: new Date("2026-05-25T00:00:00Z"),
        },
      ],
      tenantRows: [{ id: "tenant_ws_a", name: "パイロット卸 株式会社" }],
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("status DRAFT / CLOSED / CANCELLED candidates are excluded — only OPEN is published to dealers", async () => {
    authMock.mockResolvedValue(DEALER_ALPHA_SESSION);
    getTenantContextMock.mockResolvedValue(DEALER_ALPHA_CTX);
    installTx({
      // visibility 行は 4 つの候補全てに紐付いている (= 卸業者が 「公開」
      // トグルを ON にしただけの素朴な状態)。route 側で status=OPEN のみを
      // 通すため、DRAFT/CLOSED/CANCELLED は除外されるべき。
      visibilityRows: [
        { eventCandidateId: "ec_draft", relationshipId: "rel_a_alpha", isVisible: true },
        { eventCandidateId: "ec_open", relationshipId: "rel_a_alpha", isVisible: true },
        { eventCandidateId: "ec_closed", relationshipId: "rel_a_alpha", isVisible: true },
        { eventCandidateId: "ec_cancelled", relationshipId: "rel_a_alpha", isVisible: true },
      ],
      candidateRows: (
        [
          ["ec_draft", "DRAFT"],
          ["ec_open", "OPEN"],
          ["ec_closed", "CLOSED"],
          ["ec_cancelled", "CANCELLED"],
        ] as const
      ).map(([id, status]) => ({
        id,
        wholesalerId: "tenant_ws_a",
        venueProviderId: null,
        venueNegotiationId: null,
        targetMonth: "2026-07",
        scheduledDate: new Date("2026-07-15T09:00:00Z"),
        storeName: `候補-${id}`,
        address: null,
        area: null,
        deadlineAt: new Date("2026-07-01T09:00:00Z"),
        contractType: null,
        status,
        publishedAt: status === "OPEN" ? new Date("2026-06-01T00:00:00Z") : null,
        createdAt: new Date("2026-05-25T00:00:00Z"),
        updatedAt: new Date("2026-05-25T00:00:00Z"),
      })),
      tenantRows: [{ id: "tenant_ws_a", name: "パイロット卸 株式会社" }],
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; status: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe("ec_open");
    expect(body.items[0]!.status).toBe("OPEN");
  });

  it("SUSPENDED な Relationship 配下の候補は ctx.relationshipIds から既に除外されているため見えない", async () => {
    // getTenantContext は status=ACTIVE の Relationship だけを relationshipIds
    // に詰める仕様 (apps/web/lib/tenancy/context.ts)。本テストはその契約を
    // 模した ctx (relationshipIds=[rel_a_alpha] のみ、SUSPENDED の rel_z は
    // 入っていない) を渡し、visibility 行が rel_z にあっても結果に出ない
    // ことを確認する。これにより docs/02 §F-020 「関係終了済みは除外」が
    // route 〜 data 層を通して担保されていることを示す。
    authMock.mockResolvedValue(DEALER_ALPHA_SESSION);
    getTenantContextMock.mockResolvedValue(DEALER_ALPHA_CTX);
    installTx({
      visibilityRows: [
        // rel_z = 終了済み関係。ctx.relationshipIds に含まれないので
        // findMany(where.relationshipId.in) で除外される。
        {
          eventCandidateId: "ec_suspended_rel",
          relationshipId: "rel_z_suspended",
          isVisible: true,
        },
      ],
      candidateRows: [
        {
          id: "ec_suspended_rel",
          wholesalerId: "tenant_ws_a",
          venueProviderId: null,
          venueNegotiationId: null,
          targetMonth: "2026-07",
          scheduledDate: new Date("2026-07-15T09:00:00Z"),
          storeName: "終了済み関係の候補",
          address: null,
          area: null,
          deadlineAt: new Date("2026-07-01T09:00:00Z"),
          contractType: null,
          status: "OPEN",
          publishedAt: new Date("2026-06-01T00:00:00Z"),
          createdAt: new Date("2026-05-25T00:00:00Z"),
          updatedAt: new Date("2026-05-25T00:00:00Z"),
        },
      ],
      tenantRows: [{ id: "tenant_ws_a", name: "パイロット卸 株式会社" }],
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("wholesaler_admin: 403 FORBIDDEN — `event_candidate.read_for_dealer` は DEALER ロール限定", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "u_ws_admin",
        tenantId: "tenant_ws_a",
        tenantType: "WHOLESALER",
        wholesalerId: "tenant_ws_a",
        dealerId: null,
        roles: ["WHOLESALER_ADMIN"],
        isSaasAdmin: false,
      },
    });
    getTenantContextMock.mockResolvedValue({
      actorUserId: "u_ws_admin",
      tenantId: "tenant_ws_a",
      wholesalerId: "tenant_ws_a",
      relationshipIds: [],
      isSaasAdmin: false,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("FORBIDDEN");
    // policy 拒否なのでデータ層には到達しない。
    expect(withTenantMock).not.toHaveBeenCalled();
  });

  it("wholesalerId クエリで当該卸業者の候補のみに絞り込まれる", async () => {
    authMock.mockResolvedValue(DEALER_ALPHA_SESSION);
    getTenantContextMock.mockResolvedValue({
      ...DEALER_ALPHA_CTX,
      // alpha は ws_a と ws_b の 2 卸業者と取引している想定。
      relationshipIds: ["rel_a_alpha", "rel_b_alpha"],
    });
    installTx({
      visibilityRows: [
        { eventCandidateId: "ec_in_a", relationshipId: "rel_a_alpha", isVisible: true },
        { eventCandidateId: "ec_in_b", relationshipId: "rel_b_alpha", isVisible: true },
      ],
      candidateRows: [
        {
          id: "ec_in_a",
          wholesalerId: "tenant_ws_a",
          venueProviderId: null,
          venueNegotiationId: null,
          targetMonth: "2026-07",
          scheduledDate: new Date("2026-07-15T09:00:00Z"),
          storeName: "ws_a の店舗",
          address: null,
          area: null,
          deadlineAt: new Date("2026-07-01T09:00:00Z"),
          contractType: null,
          status: "OPEN",
          publishedAt: new Date("2026-06-01T00:00:00Z"),
          createdAt: new Date("2026-05-25T00:00:00Z"),
          updatedAt: new Date("2026-05-25T00:00:00Z"),
        },
        {
          id: "ec_in_b",
          wholesalerId: "tenant_ws_b",
          venueProviderId: null,
          venueNegotiationId: null,
          targetMonth: "2026-07",
          scheduledDate: new Date("2026-07-16T09:00:00Z"),
          storeName: "ws_b の店舗",
          address: null,
          area: null,
          deadlineAt: new Date("2026-07-02T09:00:00Z"),
          contractType: null,
          status: "OPEN",
          publishedAt: new Date("2026-06-01T00:00:00Z"),
          createdAt: new Date("2026-05-25T00:00:00Z"),
          updatedAt: new Date("2026-05-25T00:00:00Z"),
        },
      ],
      tenantRows: [
        { id: "tenant_ws_a", name: "卸業者 A" },
        { id: "tenant_ws_b", name: "卸業者 B" },
      ],
    });

    const res = await GET(makeRequest("wholesalerId=tenant_ws_b"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; wholesalerName: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe("ec_in_b");
    expect(body.items[0]!.wholesalerName).toBe("卸業者 B");
  });

  it("invalid targetMonth: 400 VALIDATION_FAILED", async () => {
    authMock.mockResolvedValue(DEALER_ALPHA_SESSION);
    getTenantContextMock.mockResolvedValue(DEALER_ALPHA_CTX);

    const res = await GET(makeRequest("targetMonth=invalid"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});
