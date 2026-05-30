// Integration tests for `GET /api/dealer-preferences` (T-03-07 / F-022 /
// docs/04 §1.3 S-025/S-026 / docs/05 §4.5).
//
// 5 ケース:
//   1. wholesaler_event_team: 正常取得 — visibility + preferences の結合と
//      totals の集計が返る。
//   2. wholesaler_event_team: 期限超過 + 未提出 → status=OVERDUE で totals
//      に反映される。
//   3. dealer_admin: 403 FORBIDDEN (`event_candidate.read_preferences` は
//      WHOLESALER_ADMIN / WHOLESALER_EVENT_TEAM のみ)。
//   4. 他テナントの eventCandidateId: NotFound 隠蔽で 404 を返す
//      (TENANT_ISOLATION を区別しない)。
//   5. eventCandidateId クエリ未指定: 400 VALIDATION_FAILED。

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

const { GET } = await import("../route.js");

function makeRequest(query?: string): Request {
  const url = query
    ? `http://localhost/api/dealer-preferences?${query}`
    : "http://localhost/api/dealer-preferences";
  return new Request(url, { method: "GET" });
}

const WS_EVENT_SESSION = {
  user: {
    id: "u_ws_event",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_EVENT_TEAM"],
    isSaasAdmin: false,
  },
};

const WS_EVENT_CTX = {
  actorUserId: "u_ws_event",
  tenantId: "tenant_ws_a",
  wholesalerId: "tenant_ws_a",
  relationshipIds: [],
  isSaasAdmin: false,
};

const DEALER_SESSION = {
  user: {
    id: "u_dl_admin",
    tenantId: "tenant_dl_alpha",
    tenantType: "DEALER",
    wholesalerId: "tenant_ws_a",
    dealerId: "tenant_dl_alpha",
    roles: ["DEALER_ADMIN"],
    isSaasAdmin: false,
  },
};

const DEALER_CTX = {
  actorUserId: "u_dl_admin",
  tenantId: "tenant_dl_alpha",
  dealerId: "tenant_dl_alpha",
  wholesalerId: "tenant_ws_a",
  relationshipIds: ["rel_a_alpha"],
  isSaasAdmin: false,
};

interface CandidateFx {
  id: string;
  wholesalerId: string;
  targetMonth: string;
  scheduledDate: Date;
  storeName: string;
  address: string | null;
  area: string | null;
  deadlineAt: Date;
  status: string;
}

interface VisibilityFx {
  eventCandidateId: string;
  relationshipId: string;
  isVisible: boolean;
  dealerId: string;
  dealerName: string;
}

interface PreferenceFx {
  id: string;
  eventCandidateId: string;
  relationshipId: string;
  priority: number | null;
  availableDates: string[] | null;
  availablePeople: number | null;
  comment: string | null;
  submittedAt: Date;
}

interface TxFixture {
  candidates: CandidateFx[];
  visibilities: VisibilityFx[];
  preferences: PreferenceFx[];
}

function installTx(fixture: TxFixture): void {
  withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
    const tx = {
      eventCandidate: {
        findUnique: vi.fn().mockImplementation(async (args: { where: { id: string } }) => {
          return fixture.candidates.find((c) => c.id === args.where.id) ?? null;
        }),
      },
      eventCandidateVisibility: {
        findMany: vi
          .fn()
          .mockImplementation(
            async (args: { where: { eventCandidateId: string; isVisible: boolean } }) => {
              return fixture.visibilities
                .filter(
                  (v) =>
                    v.eventCandidateId === args.where.eventCandidateId &&
                    v.isVisible === args.where.isVisible,
                )
                .map((v) => ({
                  relationshipId: v.relationshipId,
                  relationship: {
                    dealerId: v.dealerId,
                    dealer: { name: v.dealerName },
                  },
                }));
            },
          ),
      },
      dealerPreference: {
        findMany: vi
          .fn()
          .mockImplementation(
            async (args: {
              where: { eventCandidateId: string; relationshipId?: { in: string[] } };
            }) => {
              return fixture.preferences.filter((p) => {
                if (p.eventCandidateId !== args.where.eventCandidateId) return false;
                if (args.where.relationshipId?.in) {
                  return args.where.relationshipId.in.includes(p.relationshipId);
                }
                return true;
              });
            },
          ),
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

describe("GET /api/dealer-preferences", () => {
  it("wholesaler_event_team: returns the cross-join of visibility and preferences with aggregated totals", async () => {
    authMock.mockResolvedValue(WS_EVENT_SESSION);
    getTenantContextMock.mockResolvedValue(WS_EVENT_CTX);
    installTx({
      candidates: [
        {
          id: "ec_open_1",
          wholesalerId: "tenant_ws_a",
          targetMonth: "2026-07",
          scheduledDate: new Date("2026-07-15T09:00:00Z"),
          storeName: "イオン横浜",
          address: "横浜市中区",
          area: "神奈川",
          // 期限は十分先（未提出は PENDING 扱い）。
          deadlineAt: new Date("2099-12-31T00:00:00Z"),
          status: "OPEN",
        },
      ],
      visibilities: [
        {
          eventCandidateId: "ec_open_1",
          relationshipId: "rel_a_alpha",
          isVisible: true,
          dealerId: "tenant_dl_alpha",
          dealerName: "二次店 alpha",
        },
        {
          eventCandidateId: "ec_open_1",
          relationshipId: "rel_a_beta",
          isVisible: true,
          dealerId: "tenant_dl_beta",
          dealerName: "二次店 beta",
        },
      ],
      preferences: [
        {
          id: "pref_a",
          eventCandidateId: "ec_open_1",
          relationshipId: "rel_a_alpha",
          priority: 1,
          availableDates: ["2026-07-15"],
          availablePeople: 3,
          comment: null,
          submittedAt: new Date("2026-06-20T09:00:00Z"),
        },
      ],
    });

    const res = await GET(makeRequest("eventCandidateId=ec_open_1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidate: { id: string; storeName: string };
      summary: {
        rows: Array<{ relationshipId: string; status: string }>;
        totals: { visible: number; submitted: number; pending: number; overdue: number };
      };
    };
    expect(body.candidate.id).toBe("ec_open_1");
    expect(body.candidate.storeName).toBe("イオン横浜");
    expect(body.summary.rows).toHaveLength(2);
    expect(body.summary.totals).toEqual({
      visible: 2,
      submitted: 1,
      pending: 1,
      overdue: 0,
    });
    const byRel = new Map(body.summary.rows.map((r) => [r.relationshipId, r.status]));
    expect(byRel.get("rel_a_alpha")).toBe("SUBMITTED");
    expect(byRel.get("rel_a_beta")).toBe("PENDING");
  });

  it("deadline passed + un-submitted dealer: status flips to OVERDUE and totals.overdue increments", async () => {
    authMock.mockResolvedValue(WS_EVENT_SESSION);
    getTenantContextMock.mockResolvedValue(WS_EVENT_CTX);
    installTx({
      candidates: [
        {
          id: "ec_past",
          wholesalerId: "tenant_ws_a",
          targetMonth: "2026-05",
          scheduledDate: new Date("2026-05-30T09:00:00Z"),
          storeName: "期限切れ店舗",
          address: null,
          area: null,
          // 過去の deadline。
          deadlineAt: new Date("2020-01-01T00:00:00Z"),
          status: "CLOSED",
        },
      ],
      visibilities: [
        {
          eventCandidateId: "ec_past",
          relationshipId: "rel_overdue",
          isVisible: true,
          dealerId: "tenant_dl_x",
          dealerName: "未提出二次店",
        },
      ],
      preferences: [],
    });

    const res = await GET(makeRequest("eventCandidateId=ec_past"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: {
        rows: Array<{ status: string }>;
        totals: { overdue: number; pending: number };
      };
    };
    expect(body.summary.rows[0]!.status).toBe("OVERDUE");
    expect(body.summary.totals.overdue).toBe(1);
    expect(body.summary.totals.pending).toBe(0);
  });

  it("dealer_admin: 403 FORBIDDEN — `event_candidate.read_preferences` は WHOLESALER_ADMIN / WHOLESALER_EVENT_TEAM のみ", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    getTenantContextMock.mockResolvedValue(DEALER_CTX);

    const res = await GET(makeRequest("eventCandidateId=ec_anything"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("FORBIDDEN");
    // policy 拒否なのでデータ層には到達しない。
    expect(withTenantMock).not.toHaveBeenCalled();
  });

  it("cross-tenant eventCandidateId: NotFound で 404 を返す (TENANT_ISOLATION を区別しない)", async () => {
    authMock.mockResolvedValue(WS_EVENT_SESSION);
    getTenantContextMock.mockResolvedValue(WS_EVENT_CTX);
    // RLS 配下の findUnique は他テナント分を null で返す挙動を模す。
    installTx({
      candidates: [],
      visibilities: [],
      preferences: [],
    });

    const res = await GET(makeRequest("eventCandidateId=ec_other_tenant"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("NOT_FOUND");
  });

  it("missing eventCandidateId query: 400 VALIDATION_FAILED", async () => {
    authMock.mockResolvedValue(WS_EVENT_SESSION);
    getTenantContextMock.mockResolvedValue(WS_EVENT_CTX);

    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});
