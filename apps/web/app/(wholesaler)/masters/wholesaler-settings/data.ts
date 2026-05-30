// Server-side data loader for the wholesaler-settings page (S-052 sub /
// F-015 §F-016).
//
// 三段ガード (auth → assertCan(wholesaler_settings.read) → withTenant)。
// レコードが存在しないテナントには Prisma `@default` と同じ既定値を返す
// (WHOLESALER_SETTINGS_DEFAULTS)。

import "server-only";

import { WHOLESALER_SETTINGS_DEFAULTS, type PiiMaskingMode } from "@solar/contracts";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface WholesalerSettingsView {
  wholesalerId: string;
  cancelDeadlineDays: number;
  fiscalYearStartMonth: number;
  piiMaskingMode: PiiMaskingMode;
}

async function requireReadCtx() {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      message: "Session missing — sign in is required",
    });
  }
  const ctx = await getTenantContext();
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
    action: "wholesaler_settings.read",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

export async function getWholesalerSettings(): Promise<WholesalerSettingsView | null> {
  const ctx = await requireReadCtx();
  if (!ctx.wholesalerId) return null;
  const wholesalerId = ctx.wholesalerId;
  return withTenant(ctx, async (tx) => {
    const row = await tx.wholesalerSettings.findUnique({
      where: { wholesalerId },
      select: {
        wholesalerId: true,
        cancelDeadlineDays: true,
        fiscalYearStartMonth: true,
        piiMaskingMode: true,
      },
    });
    if (!row) {
      return {
        wholesalerId,
        ...WHOLESALER_SETTINGS_DEFAULTS,
      };
    }
    return {
      wholesalerId: row.wholesalerId,
      cancelDeadlineDays: row.cancelDeadlineDays,
      fiscalYearStartMonth: row.fiscalYearStartMonth,
      piiMaskingMode: row.piiMaskingMode as PiiMaskingMode,
    };
  });
}
