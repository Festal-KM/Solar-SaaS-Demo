// Server Action three-step idiom — `getTenantContext()` → `assertCan()` →
// `withTenant()` (docs/05 §6.6 §6.10).
//
// MVP keeps this as a thin template only. Full adoption lands in SP-02+ when
// the first business Server Actions appear. The shape stays here so domain
// modules can rely on a stable import path.
//
// Usage sketch:
//
//   export const finalizeMonthlyReport = withServerActionContext(
//     {
//       action: "monthly_report.finalize",
//       resource: ({ input }) => ({ wholesalerId: input.wholesalerId }),
//     },
//     async ({ tx, ctx, input }) => {
//       return MonthlyReportService.finalize(tx, ctx, input);
//     },
//   );

import { withTenant, type TenantContext, type TxClient } from "@solar/db";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan, type PermissionAction, type PermissionResource } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";

export interface ServerActionEnvelope<TInput> {
  ctx: TenantContext;
  tx: TxClient;
  input: TInput;
}

export interface ServerActionOptions<TInput> {
  action: PermissionAction;
  /**
   * Resolves the resource scope from the input. Optional — actions that don't
   * touch tenant-scoped resources (e.g. self-profile read) leave this off.
   */
  resource?: (args: { input: TInput; ctx: TenantContext }) => PermissionResource | undefined;
}

export function withServerActionContext<TInput, TOutput>(
  options: ServerActionOptions<TInput>,
  handler: (env: ServerActionEnvelope<TInput>) => Promise<TOutput>,
): (input: TInput) => Promise<TOutput> {
  return async (input: TInput) => {
    // We read the session once here for the role list (TenantContext keeps
    // only ids; roles live on the JWT). `getTenantContext()` performs a second
    // `auth()` call internally — acceptable for the template at this stage,
    // and the cost is one cached lookup. SP-02+ may merge the two reads into
    // a single helper if profiling shows it matters.
    const session = await auth();
    if (!session?.user) {
      throw new UnauthorizedError({
        code: "INVALID_CREDENTIALS",
        message: "Session missing — sign in is required",
      });
    }
    const ctx = await getTenantContext();
    const resource = options.resource?.({ input, ctx });
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
      action: options.action,
      resource,
    });
    return withTenant(ctx, (tx) => handler({ ctx, tx, input }));
  };
}
