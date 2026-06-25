// Unit tests for the 商談履歴 activity Server Actions (F-031).
//
// Covers:
//   1. createCustomerActivity creates the activity + nested tasks/files
//      (wholesaler_admin, customer.update path).
//   2. Forbidden role (WHOLESALER_EVENT_TEAM is NOT in customer.update) → 403.
//   3. Missing customer (in-tenant findUnique returns null) → NotFoundError.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "../../../../lib/errors.js";

import type * as DbModule from "@solar/db";

const authMock = vi.fn();
const relationshipFindManyMock = vi.fn();
const customerFindUniqueMock = vi.fn();
const userFindUniqueMock = vi.fn();
const activityCreateMock = vi.fn();
const taskCreateMock = vi.fn();
const fileCreateMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@solar/storage", () => ({
  presignUpload: vi.fn(),
  presignDownload: vi.fn(),
}));

vi.mock("@solar/db", async (orig) => {
  const actual = await orig<typeof DbModule>();
  const tx = {
    customer: {
      findUnique: (...args: unknown[]) => customerFindUniqueMock(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
    },
    customerActivity: {
      create: (...args: unknown[]) => activityCreateMock(...args),
    },
    customerTask: {
      create: (...args: unknown[]) => taskCreateMock(...args),
    },
    customerFile: {
      create: (...args: unknown[]) => fileCreateMock(...args),
    },
  };
  return {
    ...actual,
    rawPrisma: {
      relationship: {
        findMany: (...args: unknown[]) => relationshipFindManyMock(...args),
      },
    },
    withTenant: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
});

const { createCustomerActivity } = await import("../[id]/activity-actions.js");

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

beforeEach(() => {
  authMock.mockReset();
  relationshipFindManyMock.mockReset();
  customerFindUniqueMock.mockReset();
  userFindUniqueMock.mockReset();
  activityCreateMock.mockReset();
  taskCreateMock.mockReset();
  fileCreateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("createCustomerActivity", () => {
  it("creates the activity plus nested tasks and files for wholesaler_admin", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    customerFindUniqueMock.mockResolvedValue({ id: "cust_1" });
    activityCreateMock.mockResolvedValue({ id: "act_1" });
    taskCreateMock.mockResolvedValue({ id: "task_1" });
    fileCreateMock.mockResolvedValue({ id: "file_1" });

    const result = await createCustomerActivity({
      customerId: "cust_1",
      occurredAt: "2026-05-20",
      category: "phone",
      detail: "見積書を送付。",
      tasks: [{ content: "フォロー連絡", dueDate: "2026-05-25", assigneeUserId: "u_ws_admin" }],
      files: [
        {
          fileKey: "customers/cust_1/uuid-quote.pdf",
          fileName: "quote.pdf",
          contentType: "application/pdf",
          size: 1024,
        },
      ],
    });

    expect(result).toEqual({ id: "act_1" });

    expect(activityCreateMock).toHaveBeenCalledTimes(1);
    const activityArgs = activityCreateMock.mock.calls[0]![0] as {
      data: { customerId: string; category: string; detail: string; createdByUserId: string; occurredAt: Date };
    };
    expect(activityArgs.data.customerId).toBe("cust_1");
    expect(activityArgs.data.category).toBe("phone");
    expect(activityArgs.data.createdByUserId).toBe("u_ws_admin");
    expect(activityArgs.data.occurredAt).toBeInstanceOf(Date);

    expect(taskCreateMock).toHaveBeenCalledTimes(1);
    const taskArgs = taskCreateMock.mock.calls[0]![0] as {
      data: { customerId: string; activityId: string; content: string; dueDate: Date | null; assigneeUserId: string | null };
    };
    expect(taskArgs.data.activityId).toBe("act_1");
    expect(taskArgs.data.content).toBe("フォロー連絡");
    expect(taskArgs.data.dueDate).toBeInstanceOf(Date);
    expect(taskArgs.data.assigneeUserId).toBe("u_ws_admin");

    expect(fileCreateMock).toHaveBeenCalledTimes(1);
    const fileArgs = fileCreateMock.mock.calls[0]![0] as {
      data: { activityId: string; fileKey: string; fileName: string; uploadedByUserId: string };
    };
    expect(fileArgs.data.activityId).toBe("act_1");
    expect(fileArgs.data.fileKey).toBe("customers/cust_1/uuid-quote.pdf");
    expect(fileArgs.data.uploadedByUserId).toBe("u_ws_admin");

    expect(revalidatePathMock).toHaveBeenCalledWith("/customers/cust_1");
    // 担当者未指定なら assigneeUserId は null、User 検証は走らない。
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(activityArgs.data).toMatchObject({ assigneeUserId: null });
  });

  it("validates and persists assigneeUserId when provided (in-tenant user)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    customerFindUniqueMock.mockResolvedValue({ id: "cust_1" });
    userFindUniqueMock.mockResolvedValue({ id: "u_closer" });
    activityCreateMock.mockResolvedValue({ id: "act_2" });

    await createCustomerActivity({
      customerId: "cust_1",
      occurredAt: "2026-05-20",
      category: "quote",
      detail: "見積提示",
      assigneeUserId: "u_closer",
    });

    expect(userFindUniqueMock).toHaveBeenCalledTimes(1);
    const activityArgs = activityCreateMock.mock.calls[0]![0] as {
      data: { assigneeUserId: string | null };
    };
    expect(activityArgs.data.assigneeUserId).toBe("u_closer");
  });

  it("rejects an out-of-tenant assigneeUserId (RLS lookup returns null)", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    customerFindUniqueMock.mockResolvedValue({ id: "cust_1" });
    userFindUniqueMock.mockResolvedValue(null);

    await expect(
      createCustomerActivity({
        customerId: "cust_1",
        occurredAt: "2026-05-20",
        category: "phone",
        detail: "x",
        assigneeUserId: "u_other_tenant",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(activityCreateMock).not.toHaveBeenCalled();
  });

  it("forbids WHOLESALER_EVENT_TEAM (not in customer.update allow-list)", async () => {
    authMock.mockResolvedValue({
      user: { ...WS_SESSION.user, roles: ["WHOLESALER_EVENT_TEAM"] },
    });

    await expect(
      createCustomerActivity({
        customerId: "cust_1",
        occurredAt: "2026-05-20",
        category: "phone",
        detail: "x",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(activityCreateMock).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the customer is not in-tenant", async () => {
    authMock.mockResolvedValue(WS_SESSION);
    customerFindUniqueMock.mockResolvedValue(null);

    await expect(
      createCustomerActivity({
        customerId: "cust_missing",
        occurredAt: "2026-05-20",
        category: "other",
        detail: "x",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(activityCreateMock).not.toHaveBeenCalled();
  });
});
