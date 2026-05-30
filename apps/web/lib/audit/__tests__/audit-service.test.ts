// Unit tests for AuditService — T-07-08 / F-055 / docs/05 §6.9.
//
// Five cases:
//   1. Normal recording — AuditLog INSERT called with correct fields.
//   2. PII redact — phone/address/name in before/after are replaced with "***".
//   3. Non-PII fields pass through unmodified.
//   4. null before/after — stored as undefined (no JSON column written).
//   5. All required fields present in the created record.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordAudit, redactPii } from "../audit-service.js";

// ---------------------------------------------------------------------------
// tx mock
// ---------------------------------------------------------------------------

const auditLogCreateMock = vi.fn();

const tx = {
  auditLog: {
    create: (...args: unknown[]) => auditLogCreateMock(...args),
  },
} as unknown as import("@solar/db").TxClient;

beforeEach(() => {
  auditLogCreateMock.mockReset();
  auditLogCreateMock.mockResolvedValue({ id: BigInt(1) });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("recordAudit", () => {
  // Case 1 — normal recording
  it("1. inserts AuditLog with the provided action, targetType, targetId, tenantId", async () => {
    await recordAudit(tx, {
      actorUserId: "user_1",
      action: "CANCEL",
      targetType: "Contract",
      targetId: "contract_abc",
      tenantId: "tenant_ws_1",
    });

    expect(auditLogCreateMock).toHaveBeenCalledOnce();
    const { data } = auditLogCreateMock.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data.actorUserId).toBe("user_1");
    expect(data.action).toBe("CANCEL");
    expect(data.targetType).toBe("Contract");
    expect(data.targetId).toBe("contract_abc");
    expect(data.tenantId).toBe("tenant_ws_1");
  });

  // Case 2 — PII redact in before/after
  it("2. redacts phone, address, and name fields in before/after payloads", async () => {
    const before = {
      status: "CONTRACTED",
      phone: "090-1234-5678",
      address: "東京都新宿区1-1",
      name: "山田 太郎",
      amount: 1000000,
    };
    const after = {
      status: "CANCELLED",
      phone: "090-1234-5678",
      address: "東京都新宿区1-1",
      name: "山田 太郎",
      amount: 1000000,
    };

    await recordAudit(tx, {
      actorUserId: "user_ws_admin",
      action: "CANCEL",
      targetType: "Contract",
      targetId: "contract_pii",
      tenantId: "tenant_ws_1",
      before,
      after,
    });

    const { data } = auditLogCreateMock.mock.calls[0]![0] as {
      data: { before: Record<string, unknown>; after: Record<string, unknown> };
    };

    // PII keys must be masked
    expect(data.before.phone).toBe("***");
    expect(data.before.address).toBe("***");
    expect(data.before.name).toBe("***");
    expect(data.after.phone).toBe("***");
    expect(data.after.address).toBe("***");
    expect(data.after.name).toBe("***");

    // Non-PII fields are untouched
    expect(data.before.status).toBe("CONTRACTED");
    expect(data.before.amount).toBe(1000000);
    expect(data.after.status).toBe("CANCELLED");
  });

  // Case 3 — non-PII fields pass through
  it("3. non-PII fields in before/after pass through unmodified", async () => {
    const before = { salesPrice: "5000000", incentiveTargetType: "PROJECT_PROFIT" };
    const after = { salesPrice: "5000000", incentiveTargetType: "MANUAL" };

    await recordAudit(tx, {
      actorUserId: "user_ws_admin",
      action: "MANUAL_ADJUST",
      targetType: "GrossProfit",
      targetId: "gp_xyz",
      tenantId: "tenant_ws_1",
      before,
      after,
    });

    const { data } = auditLogCreateMock.mock.calls[0]![0] as {
      data: { before: Record<string, unknown>; after: Record<string, unknown> };
    };
    expect(data.before.salesPrice).toBe("5000000");
    expect(data.before.incentiveTargetType).toBe("PROJECT_PROFIT");
    expect(data.after.incentiveTargetType).toBe("MANUAL");
  });

  // Case 4 — null before/after are stored as undefined
  it("4. null before/after are omitted from the INSERT data", async () => {
    await recordAudit(tx, {
      actorUserId: "user_ws_admin",
      action: "FINALIZE",
      targetType: "MonthlyReport",
      targetId: "report_1",
      tenantId: "tenant_ws_1",
      before: null,
      after: null,
    });

    const { data } = auditLogCreateMock.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data.before).toBeUndefined();
    expect(data.after).toBeUndefined();
  });

  // Case 5 — all required fields are present
  it("5. all required fields are populated in the INSERT", async () => {
    await recordAudit(tx, {
      actorUserId: "user_ws_admin",
      action: "REVEAL_PII",
      targetType: "Customer",
      targetId: "customer_1",
      tenantId: "tenant_ws_1",
      after: { reason: "operator requested" },
      ip: "192.0.2.1",
      userAgent: "Mozilla/5.0",
    });

    const { data } = auditLogCreateMock.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data.actorUserId).toBeTruthy();
    expect(data.action).toBe("REVEAL_PII");
    expect(data.targetType).toBe("Customer");
    expect(data.targetId).toBe("customer_1");
    expect(data.tenantId).toBe("tenant_ws_1");
    expect(data.ip).toBe("192.0.2.1");
    expect(data.userAgent).toBe("Mozilla/5.0");
    expect(data.after).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// redactPii unit tests (pure function)
// ---------------------------------------------------------------------------

describe("redactPii", () => {
  it("redacts phone, address, name and leaves other keys intact", () => {
    const result = redactPii({
      phone: "090-9999-0000",
      address: "大阪市北区",
      name: "佐藤 花子",
      contractId: "c_1",
      amount: 500,
    });
    expect(result?.phone).toBe("***");
    expect(result?.address).toBe("***");
    expect(result?.name).toBe("***");
    expect(result?.contractId).toBe("c_1");
    expect(result?.amount).toBe(500);
  });

  it("returns null for null input", () => {
    expect(redactPii(null)).toBeNull();
    expect(redactPii(undefined)).toBeNull();
  });
});
