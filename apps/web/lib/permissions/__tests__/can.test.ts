// `assertCan` unit tests (T-01-08).
//
// Verifies the SP-01 coarse role × action matrix:
//   1. dealer_admin reads event candidates inside own relationship → OK
//   2. dealer_staff attempts incentive.adjust → ForbiddenError
//   3. wholesaler_admin creates event candidate in own tenant → OK
//   4. dealer_admin touches another tenant's relationship → TenantIsolationError (code=TENANT_ISOLATION)
//   5. saas_admin bypasses everything → OK
//   6. wholesaler_admin reads gross profit cross-tenant → TenantIsolationError (code=TENANT_ISOLATION)
//   7. unknown action → ForbiddenError (fail-closed)

import { describe, expect, it } from "vitest";

import { ForbiddenError, TenantIsolationError } from "../../errors.js";
import { assertCan, type PermissionUser } from "../can.js";

const wholesalerAdmin: PermissionUser = {
  userId: "u_ws_admin",
  roles: ["WHOLESALER_ADMIN"],
  isSaasAdmin: false,
  tenantId: "tenant_ws_a",
  wholesalerId: "tenant_ws_a",
  relationshipIds: [],
};

const dealerAdmin: PermissionUser = {
  userId: "u_dl_admin",
  roles: ["DEALER_ADMIN"],
  isSaasAdmin: false,
  tenantId: "tenant_dl_x",
  dealerId: "tenant_dl_x",
  wholesalerId: "tenant_ws_a",
  relationshipIds: ["rel_a_x"],
};

const dealerStaff: PermissionUser = {
  userId: "u_dl_staff",
  roles: ["DEALER_STAFF"],
  isSaasAdmin: false,
  tenantId: "tenant_dl_x",
  dealerId: "tenant_dl_x",
  wholesalerId: "tenant_ws_a",
  relationshipIds: ["rel_a_x"],
};

const saasAdmin: PermissionUser = {
  userId: "u_sa",
  roles: ["SAAS_ADMIN"],
  isSaasAdmin: true,
  relationshipIds: [],
};

describe("assertCan()", () => {
  it("allows dealer_admin to read event candidates in their own relationship", () => {
    expect(() =>
      assertCan({
        user: dealerAdmin,
        action: "event_candidate.read",
        resource: { relationshipId: "rel_a_x" },
      }),
    ).not.toThrow();
  });

  it("forbids dealer_staff from adjusting incentives", () => {
    expect(() =>
      assertCan({
        user: dealerStaff,
        action: "incentive.adjust",
        resource: { wholesalerId: "tenant_ws_a" },
      }),
    ).toThrow(ForbiddenError);
  });

  it("allows wholesaler_admin to create event candidates in their own tenant", () => {
    expect(() =>
      assertCan({
        user: wholesalerAdmin,
        action: "event_candidate.create",
        resource: { wholesalerId: "tenant_ws_a" },
      }),
    ).not.toThrow();
  });

  it("forbids dealer_admin from touching another tenant's relationship", () => {
    const call = () =>
      assertCan({
        user: dealerAdmin,
        action: "event_candidate.read",
        resource: { relationshipId: "rel_OTHER" },
      });

    expect(call).toThrow(TenantIsolationError);
    try {
      call();
    } catch (err) {
      expect(err).toBeInstanceOf(TenantIsolationError);
      expect((err as TenantIsolationError).code).toBe("TENANT_ISOLATION");
    }
  });

  it("forbids wholesaler_admin from accessing a different wholesaler's data", () => {
    const call = () =>
      assertCan({
        user: wholesalerAdmin,
        action: "gross_profit.read",
        resource: { wholesalerId: "tenant_ws_B" },
      });

    expect(call).toThrow(TenantIsolationError);
    try {
      call();
    } catch (err) {
      expect(err).toBeInstanceOf(TenantIsolationError);
      expect((err as TenantIsolationError).code).toBe("TENANT_ISOLATION");
    }
  });

  it("forbids dealer_admin from finalizing monthly reports (finance gate)", () => {
    expect(() =>
      assertCan({
        user: dealerAdmin,
        action: "monthly_report.finalize",
        resource: { wholesalerId: "tenant_ws_a" },
      }),
    ).toThrow(ForbiddenError);
  });

  it("allows saas_admin to bypass every action × scope check", () => {
    expect(() =>
      assertCan({
        user: saasAdmin,
        action: "incentive.adjust",
        resource: { wholesalerId: "tenant_ws_a" },
      }),
    ).not.toThrow();

    expect(() =>
      assertCan({
        user: saasAdmin,
        action: "audit_log.read",
        resource: { wholesalerId: "any-tenant" },
      }),
    ).not.toThrow();
  });

  it("rejects unknown actions with ForbiddenError (fail-closed)", () => {
    expect(() =>
      assertCan({
        user: wholesalerAdmin,
        action: "this.does.not.exist",
        resource: { wholesalerId: "tenant_ws_a" },
      }),
    ).toThrow(ForbiddenError);
  });

  it("skips tenant scope check when the resource is omitted", () => {
    expect(() =>
      assertCan({
        user: dealerAdmin,
        action: "self.read",
      }),
    ).not.toThrow();
  });

  it("forbids dealer roles from adjusting incentives even on their own wholesaler", () => {
    expect(() =>
      assertCan({
        user: dealerAdmin,
        action: "incentive.adjust",
        resource: { wholesalerId: "tenant_ws_a" },
      }),
    ).toThrow(ForbiddenError);
  });
});
