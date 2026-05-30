// Integration tests for `GET /api/me/shifts` (T-03-11 / F-026 / docs/05 §4.6).
//
// 受入基準:
//   1. 自分の割当のみ返る — 他ユーザーのシフトは `userId` フィルタで除外される。
//   2. 期間フィルタが正しく動作する — from/to で startPlanned を絞り込む。
//   3. from=YYYY-MM-DD 形式違反 → 400 VALIDATION_FAILED。
//   4. from > to → 400 VALIDATION_FAILED。
//   5. dealer ロール → 403 FORBIDDEN（shift.read_own は wholesaler ロール限定）。
//   6. 未認証 → 401 INVALID_CREDENTIALS。

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

function makeRequest(query?: string): Request {
  const url = query
    ? `http://localhost/api/me/shifts?${query}`
    : "http://localhost/api/me/shifts";
  return new Request(url, { method: "GET" });
}

const FIELD_STAFF_SESSION = {
  user: {
    id: "u_field_1",
    tenantId: "tenant_ws_a",
    tenantType: "WHOLESALER",
    wholesalerId: "tenant_ws_a",
    dealerId: null,
    roles: ["WHOLESALER_FIELD_STAFF"],
    isSaasAdmin: false,
  },
};

const FIELD_STAFF_CTX = {
  actorUserId: "u_field_1",
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

// Minimal shift row shape returned by Prisma `include { event { ... } }`.
interface ShiftRow {
  id: string;
  eventId: string;
  userId: string;
  role: string;
  startPlanned: Date;
  endPlanned: Date;
  status: string;
  note: string | null;
  startActual: Date | null;
  endActual: Date | null;
  createdAt: Date;
  updatedAt: Date;
  event: {
    id: string;
    status: string;
    eventCandidate: {
      storeName: string;
      scheduledDate: Date;
      area: string | null;
      address: string | null;
    };
  };
}

function makeShiftRow(overrides: Partial<ShiftRow> & { id: string; userId: string }): ShiftRow {
  return {
    eventId: "evt_1",
    role: "CATCH",
    startPlanned: new Date("2026-06-15T09:00:00Z"),
    endPlanned: new Date("2026-06-15T18:00:00Z"),
    status: "ASSIGNED",
    note: null,
    startActual: null,
    endActual: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    event: {
      id: "evt_1",
      status: "PLANNED",
      eventCandidate: {
        storeName: "イオン横浜",
        scheduledDate: new Date("2026-06-15T09:00:00Z"),
        area: "神奈川",
        address: "横浜市中区",
      },
    },
    ...overrides,
  };
}

function installTx(rows: ShiftRow[]): void {
  withTenantMock.mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
    const tx = {
      eventShift: {
        findMany: vi
          .fn()
          .mockImplementation(
            async (args: {
              where: { userId: string; startPlanned: { gte: Date; lte: Date } };
            }) => {
              return rows.filter((r) => {
                if (r.userId !== args.where.userId) return false;
                if (r.startPlanned < args.where.startPlanned.gte) return false;
                if (r.startPlanned > args.where.startPlanned.lte) return false;
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

describe("GET /api/me/shifts", () => {
  it("自分のシフトのみ返る — 他ユーザーのシフトは含まれない", async () => {
    authMock.mockResolvedValue(FIELD_STAFF_SESSION);
    getTenantContextMock.mockResolvedValue(FIELD_STAFF_CTX);

    const ownShift = makeShiftRow({ id: "sh_own", userId: "u_field_1" });
    const otherShift = makeShiftRow({
      id: "sh_other",
      userId: "u_field_2",
      startPlanned: new Date("2026-06-15T09:00:00Z"),
    });
    installTx([ownShift, otherShift]);

    const res = await GET(makeRequest("from=2026-06-15&to=2026-06-15"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shifts: Array<{ id: string; userId: string }> };

    // 自分のシフトだけが返る。
    expect(body.shifts).toHaveLength(1);
    expect(body.shifts[0]!.id).toBe("sh_own");
    expect(body.shifts[0]!.userId).toBe("u_field_1");
  });

  it("期間フィルタが正しく動作する — from/to 範囲外のシフトは除外される", async () => {
    authMock.mockResolvedValue(FIELD_STAFF_SESSION);
    getTenantContextMock.mockResolvedValue(FIELD_STAFF_CTX);

    const shiftIn = makeShiftRow({
      id: "sh_in_range",
      userId: "u_field_1",
      startPlanned: new Date("2026-06-15T09:00:00Z"),
    });
    const shiftBefore = makeShiftRow({
      id: "sh_before",
      userId: "u_field_1",
      startPlanned: new Date("2026-06-14T09:00:00Z"),
    });
    const shiftAfter = makeShiftRow({
      id: "sh_after",
      userId: "u_field_1",
      startPlanned: new Date("2026-06-17T09:00:00Z"),
    });
    installTx([shiftBefore, shiftIn, shiftAfter]);

    const res = await GET(makeRequest("from=2026-06-15&to=2026-06-16"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shifts: Array<{ id: string }> };

    expect(body.shifts).toHaveLength(1);
    expect(body.shifts[0]!.id).toBe("sh_in_range");
  });

  it("dealer_admin: 403 FORBIDDEN — shift.read_own は wholesaler ロール限定", async () => {
    authMock.mockResolvedValue(DEALER_SESSION);
    getTenantContextMock.mockResolvedValue(DEALER_CTX);

    const res = await GET(makeRequest("from=2026-06-15&to=2026-06-15"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("FORBIDDEN");
    expect(withTenantMock).not.toHaveBeenCalled();
  });

  it("from が YYYY-MM-DD 形式違反: 400 VALIDATION_FAILED", async () => {
    authMock.mockResolvedValue(FIELD_STAFF_SESSION);
    getTenantContextMock.mockResolvedValue(FIELD_STAFF_CTX);

    const res = await GET(makeRequest("from=2026/06/15"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("from > to: 400 VALIDATION_FAILED", async () => {
    authMock.mockResolvedValue(FIELD_STAFF_SESSION);
    getTenantContextMock.mockResolvedValue(FIELD_STAFF_CTX);

    const res = await GET(makeRequest("from=2026-06-20&to=2026-06-15"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("未認証: 401 INVALID_CREDENTIALS", async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_CREDENTIALS");
  });
});
