// Integration tests for notification API routes (T-07-04 / F-052).
//
// Cases covered:
//   1. GET /api/notifications — 認証済みユーザーの通知一覧とページネーション情報を返す
//   2. GET /api/notifications — unreadOnly=true のとき readAt:null 条件で絞り込む
//   3. GET /api/notifications — 未認証 → 401
//   4. GET /api/notifications/unread-count — 未読数を返す
//   5. GET /api/notifications/unread-count — 未認証 → 401
//   6. POST /api/notifications/read — 単件既読更新（recipientUserId フィルタ必須）
//   7. POST /api/notifications/read — notificationId 未指定 → 400
//   8. POST /api/notifications/read-all — 全既読更新（recipientUserId フィルタ必須）

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

// Import handlers at module scope (same pattern as existing tests).
const { GET: getNotifications } = await import("../route.js");
const { GET: getUnreadCount } = await import("../unread-count/route.js");
const { POST: postRead } = await import("../read/route.js");
const { POST: postReadAll } = await import("../read-all/route.js");

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

const SAMPLE_NOTIFICATIONS = [
  {
    id: "notif_1",
    type: "CONTRACT_CONTRACTED",
    title: "契約が成立しました",
    body: "山田 太郎様との契約が成立しました",
    payload: {},
    readAt: null,
    createdAt: new Date("2026-05-25T10:00:00Z"),
  },
  {
    id: "notif_2",
    type: "EVENT_PUBLISHED",
    title: "新しいイベント候補が公開されました",
    body: "6月のイベント候補が公開されました",
    payload: {},
    readAt: new Date("2026-05-24T08:00:00Z"),
    createdAt: new Date("2026-05-24T07:00:00Z"),
  },
];

beforeEach(() => {
  authMock.mockReset();
  getTenantContextMock.mockReset();
  withTenantMock.mockReset();
});

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------

describe("GET /api/notifications", () => {
  it("1. 認証済みユーザーの通知一覧とページネーション情報を返す", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    getTenantContextMock.mockResolvedValue(WS_CTX);

    withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        notification: {
          findMany: vi.fn().mockResolvedValue(SAMPLE_NOTIFICATIONS),
          count: vi.fn().mockResolvedValue(2),
        },
      };
      return fn(tx);
    });

    const req = new Request("http://localhost/api/notifications?page=1", { method: "GET" });
    const res = await getNotifications(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(body.totalPages).toBe(1);
  });

  it("2. unreadOnly=true のとき readAt:null 条件で絞り込む", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    getTenantContextMock.mockResolvedValue(WS_CTX);

    let capturedWhere: Record<string, unknown> = {};
    withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        notification: {
          findMany: vi.fn().mockImplementation(
            async (args: { where: Record<string, unknown> }) => {
              capturedWhere = args.where;
              return [SAMPLE_NOTIFICATIONS[0]];
            },
          ),
          count: vi.fn().mockResolvedValue(1),
        },
      };
      return fn(tx);
    });

    const req = new Request("http://localhost/api/notifications?unreadOnly=true", {
      method: "GET",
    });
    const res = await getNotifications(req);

    expect(res.status).toBe(200);
    expect(capturedWhere).toMatchObject({ readAt: null });
  });

  it("3. 未認証 → 401 INVALID_CREDENTIALS", async () => {
    authMock.mockResolvedValue(null);

    const req = new Request("http://localhost/api/notifications", { method: "GET" });
    const res = await getNotifications(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_CREDENTIALS");
  });
});

// ---------------------------------------------------------------------------
// GET /api/notifications/unread-count
// ---------------------------------------------------------------------------

describe("GET /api/notifications/unread-count", () => {
  it("4. 未読数を返す", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    getTenantContextMock.mockResolvedValue(WS_CTX);

    withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        notification: {
          count: vi.fn().mockResolvedValue(3),
        },
      };
      return fn(tx);
    });

    const res = await getUnreadCount();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(3);
  });

  it("5. 未認証 → 401", async () => {
    authMock.mockResolvedValue(null);

    const res = await getUnreadCount();

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/read
// ---------------------------------------------------------------------------

describe("POST /api/notifications/read", () => {
  it("6. 単件既読更新 — recipientUserId フィルタ付きで updateMany を呼ぶ", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    getTenantContextMock.mockResolvedValue(WS_CTX);

    let capturedWhere: Record<string, unknown> = {};
    withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        notification: {
          updateMany: vi.fn().mockImplementation(
            async (args: { where: Record<string, unknown> }) => {
              capturedWhere = args.where;
              return { count: 1 };
            },
          ),
        },
      };
      return fn(tx);
    });

    const req = new Request("http://localhost/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId: "notif_1" }),
    });
    const res = await postRead(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    // recipientUserId must be constrained to the caller's userId only
    expect(capturedWhere).toMatchObject({
      id: "notif_1",
      recipientUserId: "u_ws_admin",
      readAt: null,
    });
  });

  it("7. notificationId 未指定 → 400 VALIDATION_FAILED", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    getTenantContextMock.mockResolvedValue(WS_CTX);

    const req = new Request("http://localhost/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await postRead(req);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/read-all
// ---------------------------------------------------------------------------

describe("POST /api/notifications/read-all", () => {
  it("8. 全既読更新 — recipientUserId + readAt:null で updateMany を呼ぶ", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    getTenantContextMock.mockResolvedValue(WS_CTX);

    let capturedWhere: Record<string, unknown> = {};
    withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        notification: {
          updateMany: vi.fn().mockImplementation(
            async (args: { where: Record<string, unknown> }) => {
              capturedWhere = args.where;
              return { count: 5 };
            },
          ),
        },
      };
      return fn(tx);
    });

    const res = await postReadAll();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; updatedCount: number };
    expect(body.ok).toBe(true);
    expect(body.updatedCount).toBe(5);
    // Must only affect the caller's own notifications
    expect(capturedWhere).toMatchObject({
      recipientUserId: "u_ws_admin",
      readAt: null,
    });
  });
});
