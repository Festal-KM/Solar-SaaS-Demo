// Server-side data loader for the wholesaler customer list (T-04-07 / F-032 /
// docs/04 §1.3 S-032 / docs/05 §4.7).
//
// Wholesaler sees all customers in their `wholesalerId` tenant.
// PII (phone / address / name) is masked according to the viewer's
// effective mode derived from WholesalerSettings.piiMaskingMode.
//
// The list surfaces four INDEPENDENT status dimensions:
//   - マエカク (maekaku): an appointment carrying a PreCall (derived).
//   - 契約状況 / 施工状況 / 設置申請状況: stored as MANUAL columns on Customer
//     and read straight through (edited by hand on the detail page).
//
// Filtering on the three manual statuses is direct column equality; マエカク stays
// a relation `some`/`none` clause. All filters apply at the DB `where` level so
// pagination totals stay correct.
//
// Pagination: pageSize ∈ {20, 50, 100}, default 20.

import "server-only";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { maskName } from "@solar/contracts/services/masking";
import type { ViewerContext } from "@solar/contracts/services/masking";

import type { Prisma } from "@solar/db";

// Reuse the wholesaler-user loader (ACTIVE users in tenant, sorted by name) for
// the 担当者 dropdown; re-export so callers can import it from "./data" too.
export { listWholesalerUsers } from "../event-detail/data";

import { normalizePageSize } from "./constants";
import type {
  ContractStatusValue,
  ConstructionStatusValue,
  CustomerListFilter,
  CustomerListItem,
  PagedCustomerResult,
  SubsidyStatusValue,
} from "./constants";

// Re-export the shared constants/types so existing server-side importers of
// "./data" (page.tsx, api/customers/route.ts, tests) keep working unchanged.
export {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  normalizePageSize,
  CONTRACT_STATUS_VALUES,
  CONSTRUCTION_STATUS_VALUES,
  SUBSIDY_STATUS_VALUES,
  SURVEY_STATUS_VALUES,
  type PageSize,
  type ContractStatusValue,
  type ConstructionStatusValue,
  type SubsidyStatusValue,
  type SurveyStatusValue,
  type MaekakuValue,
  type CustomerListFilter,
  type CustomerListItem,
  type PagedCustomerResult,
} from "./constants";

function buildStatusWhere(filter: CustomerListFilter): Prisma.CustomerWhereInput[] {
  const clauses: Prisma.CustomerWhereInput[] = [];

  // 契約 / 施工 / 設置申請 are manual columns → direct equality.
  if (filter.contractStatus) clauses.push({ contractStatus: filter.contractStatus });
  if (filter.constructionStatus) clauses.push({ constructionStatus: filter.constructionStatus });
  if (filter.subsidyStatus) clauses.push({ subsidyStatus: filter.subsidyStatus });

  // 担当者 = the user who registered the customer (no Customer→User relation).
  if (filter.assigneeUserId) {
    clauses.push({ registeredByUserId: filter.assigneeUserId });
  }

  // マエカク有無 (preCall is a nullable to-one on Appointment).
  if (filter.maekaku === "present") {
    clauses.push({ appointments: { some: { preCall: { isNot: null } } } });
  } else if (filter.maekaku === "absent") {
    clauses.push({ appointments: { none: { preCall: { isNot: null } } } });
  }

  return clauses;
}

export async function listCustomers(
  filter: CustomerListFilter = {},
): Promise<PagedCustomerResult> {
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
    action: "customer.read",
  });

  const pageSize = normalizePageSize(filter.pageSize);
  const page = Math.max(1, filter.page ?? 1);
  const skip = (page - 1) * pageSize;

  return withTenant(ctx, async (tx) => {
    // Load piiMaskingMode from settings to build ViewerContext.
    const settings = ctx.wholesalerId
      ? await tx.wholesalerSettings.findUnique({
          where: { wholesalerId: ctx.wholesalerId },
          select: { piiMaskingMode: true },
        })
      : null;

    const piiMaskingMode = (settings?.piiMaskingMode ?? "MASKED") as
      | "FULL"
      | "PARTIAL"
      | "MASKED";

    const role = (session.user.roles[0] ?? "WHOLESALER_ADMIN") as ViewerContext["role"];
    const viewer: ViewerContext = {
      role,
      tenantType: "WHOLESALER",
      isSelfTenant: true,
      piiMaskingMode,
    };

    // Build query filter.
    const queryStr = filter.query?.trim();
    const andClauses = buildStatusWhere(filter);

    // Search also matches customers whose assignee (registeredByUserId) name
    // contains the term. Resolve matching user ids inside the tx so RLS scopes
    // the lookup to this tenant.
    const searchOr: Prisma.CustomerWhereInput[] = [];
    if (queryStr) {
      searchOr.push(
        { name: { contains: queryStr, mode: "insensitive" } },
        { phone: { contains: queryStr, mode: "insensitive" } },
        { address: { contains: queryStr, mode: "insensitive" } },
      );
      const matchedUsers = await tx.user.findMany({
        where: { name: { contains: queryStr, mode: "insensitive" } },
        select: { id: true },
      });
      if (matchedUsers.length > 0) {
        searchOr.push({ registeredByUserId: { in: matchedUsers.map((u) => u.id) } });
      }
    }

    const where: Prisma.CustomerWhereInput = {
      ...(searchOr.length > 0 ? { OR: searchOr } : {}),
      ...(andClauses.length > 0 ? { AND: andClauses } : {}),
    };

    const [rows, total] = await Promise.all([
      tx.customer.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          address: true,
          area: true,
          registeredByUserId: true,
          contractStatus: true,
          constructionStatus: true,
          subsidyStatus: true,
          updatedAt: true,
        },
      }),
      tx.customer.count({ where }),
    ]);

    const totalPages = Math.ceil(total / pageSize);
    if (rows.length === 0) {
      return { items: [], total, page, pageSize, totalPages };
    }

    const customerIds = rows.map((r) => r.id);

    // マエカク + next-appointment are still derived from appointments.
    const appointments = await tx.appointment.findMany({
      where: { customerId: { in: customerIds } },
      orderBy: { scheduledAt: "asc" },
      select: {
        customerId: true,
        scheduledAt: true,
        preCall: { select: { id: true } },
      },
    });

    // 担当者 names: batch-resolve registeredByUserId within the tenant. Dealer
    // registrants are invisible under RLS → unresolved ids fall back to "—".
    const assigneeIds = [...new Set(rows.map((r) => r.registeredByUserId))];
    const assigneeUsers = await tx.user.findMany({
      where: { id: { in: assigneeIds } },
      select: { id: true, name: true },
    });
    const assigneeNameById = new Map(assigneeUsers.map((u) => [u.id, u.name]));

    // マエカク + next-appointment selection per customer.
    const now = Date.now();
    const maekakuByCustomer = new Set<string>();
    const nextAppointmentByCustomer = new Map<string, Date>();
    const lastPastAppointmentByCustomer = new Map<string, Date>();
    for (const ap of appointments) {
      if (ap.preCall) maekakuByCustomer.add(ap.customerId);
      const at = ap.scheduledAt;
      if (at.getTime() >= now) {
        // earliest upcoming (appointments sorted scheduledAt asc → first wins).
        if (!nextAppointmentByCustomer.has(ap.customerId)) {
          nextAppointmentByCustomer.set(ap.customerId, at);
        }
      } else {
        // most recent past (keep latest seen since list is ascending).
        lastPastAppointmentByCustomer.set(ap.customerId, at);
      }
    }

    return {
      items: rows.map((r): CustomerListItem => {
        const nextUpcoming = nextAppointmentByCustomer.get(r.id);
        const lastPast = lastPastAppointmentByCustomer.get(r.id);
        const apptDate = nextUpcoming ?? lastPast ?? null;
        return {
          id: r.id,
          name: maskName(r.name, viewer),
          area: r.area ?? deriveArea(r.address),
          assigneeName: assigneeNameById.get(r.registeredByUserId) ?? "—",
          nextAppointmentAt: apptDate ? apptDate.toISOString() : null,
          maekaku: maekakuByCustomer.has(r.id) ? "present" : "absent",
          contractStatus: r.contractStatus as ContractStatusValue,
          constructionStatus: r.constructionStatus as ConstructionStatusValue,
          subsidyStatus: r.subsidyStatus as SubsidyStatusValue,
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
      total,
      page,
      pageSize,
      totalPages,
    };
  });
}

// エリア = leading 都道府県 of the address (coarse region, not PII). Returns the
// prefecture token, or null when the address has no recognizable prefecture.
export function deriveArea(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = address.match(/^(東京都|北海道|京都府|大阪府|.{2,3}県)/);
  return m ? m[1]! : null;
}
