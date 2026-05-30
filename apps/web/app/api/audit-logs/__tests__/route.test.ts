// Unit/integration tests for GET /api/audit-logs (T-07-09 / F-055).
//
// Cases covered:
//   1. 正常取得 — 認証済み wholesaler_admin が監査ログ一覧とページネーション情報を受け取れる
//   2. フィルタ — actor / action / from / to クエリが WHERE 条件に反映される
//   3. PII マスク — before/after の phone/address/name が "***" に置換される
//   4. ページネーション — page=2 のとき skip が PAGE_SIZE 分進む
//   5. 未認証 → 401
//   6. dealer_staff → 403 (audit_log.read を持たないロール)
//   7. saas_admin — テナントフィルタなしで全テナントのログを返す

import { beforeEach, describe, expect, it, vi } from "vitest";

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WS_SESSION = {
  user: {
    id: "u_ws_admin",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_ADMIN"],
    isSaasAdmin: false,
  },
};

const WS_CTX = {
  actorUserId: "u_ws_admin",
  tenantId: "tenant_ws_a",
  wholesalerId: "tenant_ws_a",
  relationshipIds: [],
  isSaasAdmin: false,
};

const SAAS_SESSION = {
  user: {
    id: "u_saas",
    tenantId: undefined,
    tenantType: undefined,
    wholesalerId: null,
    dealerId: null,
    roles: [],
    isSaasAdmin: true,
  },
};

const SAAS_CTX = {
  actorUserId: "u_saas",
  isSaasAdmin: true,
  relationshipIds: [],
};

const DEALER_SESSION = {
  user: {
    id: "u_dealer_staff",
    tenantId: "tenant_dl_a",
    tenantType: "DEALER",
    wholesalerId: null,
    dealerId: "tenant_dl_a",
    roles: ["DEALER_STAFF"],
    isSaasAdmin: false,
  },
};

const DEALER_CTX = {
  actorUserId: "u_dealer_staff",
  tenantId: "tenant_dl_a",
  dealerId: "tenant_dl_a",
  relationshipIds: ["rel_1"],
  isSaasAdmin: false,
};

// Sample AuditLog rows with PII in before/after
const SAMPLE_ROWS = [
  {
    id: BigInt(1),
    actorUserId: "u_ws_admin",
    tenantId: "tenant_ws_a",
    targetType: "Contract",
    targetId: "contract_1",
    action: "CANCEL",
    before: {
      status: "CONTRACTED",
      phone: "090-1234-5678",
      address: "東京都新宿区1-1",
      name: "山田 太郎",
    },
    after: {
      status: "CANCELLED",
      phone: "090-1234-5678",
      address: "東京都新宿区1-1",
      name: "山田 太郎",
    },
    ip: "192.0.2.1",
    userAgent: "Mozilla/5.0",
    createdAt: new Date("2026-05-25T10:00:00Z"),
  },
  {
    id: BigInt(2),
    actorUserId: "u_ws_admin",
    tenantId: "tenant_ws_a",
    targetType: "Product",
    targetId: "product_1",
    action: "UPDATE",
    before: { listPrice: "500000" },
    after: { listPrice: "550000" },
    ip: null,
    userAgent: null,
    createdAt: new Date("2026-05-24T08:00:00Z"),
  },
];

function makeTx(rows = SAMPLE_ROWS, total = SAMPLE_ROWS.length) {
  return {
    auditLog: {
      findMany: vi.fn().mockResolvedValue(rows),
      count: vi.fn().mockResolvedValue(total),
    },
  };
}

beforeEach(() => {
  authMock.mockReset();
  getTenantContextMock.mockReset();
  withTenantMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/audit-logs", () => {
  it("1. 認証済み wholesaler_admin が監査ログ一覧とページネーション情報を受け取れる", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    getTenantContextMock.mockResolvedValue(WS_CTX);
    withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) =>
      fn(makeTx()),
    );

    const req = new Request("http://localhost/api/audit-logs?page=1", { method: "GET" });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.totalPages).toBe(1);
    // id should be serialized as string (BigInt)
    expect(typeof body.items[0].id).toBe("string");
  });

  it("2. actor / action / from / to フィルタが WHERE 条件に反映される", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    getTenantContextMock.mockResolvedValue(WS_CTX);

    let capturedWhere: Record<string, unknown> = {};
    withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        auditLog: {
          findMany: vi.fn().mockImplementation(
            async (args: { where: Record<string, unknown> }) => {
              capturedWhere = args.where;
              return [SAMPLE_ROWS[0]];
            },
          ),
          count: vi.fn().mockResolvedValue(1),
        },
      };
      return fn(tx);
    });

    const req = new Request(
      "http://localhost/api/audit-logs?actor=u_ws_admin&action=CANCEL&from=2026-05-01T00:00&to=2026-05-31T23:59",
      { method: "GET" },
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(capturedWhere).toMatchObject({ actorUserId: "u_ws_admin", action: "CANCEL" });
    expect(capturedWhere).toHaveProperty("createdAt");
  });

  it("3. before/after の phone / address / name が '***' にマスクされる", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    getTenantContextMock.mockResolvedValue(WS_CTX);
    withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) =>
      fn(makeTx([SAMPLE_ROWS[0]!], 1)),
    );

    const req = new Request("http://localhost/api/audit-logs", { method: "GET" });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    const item = body.items[0];

    // PII keys masked
    expect(item.before.phone).toBe("***");
    expect(item.before.address).toBe("***");
    expect(item.before.name).toBe("***");
    expect(item.after.phone).toBe("***");
    expect(item.after.address).toBe("***");
    expect(item.after.name).toBe("***");

    // Non-PII key preserved
    expect(item.before.status).toBe("CONTRACTED");
    expect(item.after.status).toBe("CANCELLED");
  });

  it("4. page=2 のとき skip が PAGE_SIZE 分進む", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    getTenantContextMock.mockResolvedValue(WS_CTX);

    let capturedSkip: number | undefined;
    withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        auditLog: {
          findMany: vi.fn().mockImplementation(
            async (args: { skip?: number }) => {
              capturedSkip = args.skip;
              return [];
            },
          ),
          count: vi.fn().mockResolvedValue(55),
        },
      };
      return fn(tx);
    });

    const req = new Request("http://localhost/api/audit-logs?page=2", { method: "GET" });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(capturedSkip).toBe(50); // PAGE_SIZE = 50, page 2 → skip 50
    const body = await res.json();
    expect(body.page).toBe(2);
    expect(body.totalPages).toBe(2);
  });

  it("5. 未認証 → 401 INVALID_CREDENTIALS", async () => {
    authMock.mockResolvedValue(null);

    const req = new Request("http://localhost/api/audit-logs", { method: "GET" });
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("INVALID_CREDENTIALS");
  });

  it("6. dealer_staff ロール → 403 (audit_log.read 権限なし)", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    getTenantContextMock.mockResolvedValue(DEALER_CTX);

    const req = new Request("http://localhost/api/audit-logs", { method: "GET" });
    const res = await GET(req);

    expect(res.status).toBe(403);
  });

  it("7. saas_admin はテナントフィルタなしで全テナントのログを返す", async () => {
    authMock.mockResolvedValue(SAAS_SESSION);
    getTenantContextMock.mockResolvedValue(SAAS_CTX);

    let capturedWhere: Record<string, unknown> = {};
    withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        auditLog: {
          findMany: vi.fn().mockImplementation(
            async (args: { where: Record<string, unknown> }) => {
              capturedWhere = args.where;
              return SAMPLE_ROWS;
            },
          ),
          count: vi.fn().mockResolvedValue(2),
        },
      };
      return fn(tx);
    });

    const req = new Request("http://localhost/api/audit-logs", { method: "GET" });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    // saas_admin: no tenantId filter in where clause
    expect(capturedWhere).not.toHaveProperty("tenantId");
  });
});
