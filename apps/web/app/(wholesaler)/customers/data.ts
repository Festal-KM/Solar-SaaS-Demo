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

import {
  CONSTRUCTION_IN_PROGRESS_ENUMS,
  deriveConstructionStatusValue,
  normalizePageSize,
} from "./constants";
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

// 施工状況フィルタは代表施工（Construction 群）からの導出に整合させる。分類は固定優先順位
// 「進行中 > 完了 > 未着工」で、表示側の deriveConstructionStatusValue と同一の意味論:
//   in_progress = 進行中の施工が 1 件でもある
//   done        = 進行中は無いが完了の施工がある
//   not_started = 施工はあるが進行中も完了も無い（REQUEST_PENDING のみ）
// 施工 0 件の顧客のみ Customer.constructionStatus へフォールバックする。全て DB where 級で
// 評価するためページネーション件数は正しく保たれる。RLS スコープ内で contracts→constructions を辿る。
function buildConstructionStatusWhere(
  value: ConstructionStatusValue,
): Prisma.CustomerWhereInput {
  const hasInProgress: Prisma.CustomerWhereInput = {
    contracts: { some: { constructions: { some: { status: { in: [...CONSTRUCTION_IN_PROGRESS_ENUMS] } } } } },
  };
  const hasAnyConstruction: Prisma.CustomerWhereInput = {
    contracts: { some: { constructions: { some: {} } } },
  };
  const hasDone: Prisma.CustomerWhereInput = {
    contracts: { some: { constructions: { some: { status: "DONE" } } } },
  };
  const noConstructionFallback: Prisma.CustomerWhereInput = {
    AND: [{ NOT: hasAnyConstruction }, { constructionStatus: value }],
  };

  if (value === "in_progress") {
    return { OR: [hasInProgress, noConstructionFallback] };
  }
  if (value === "done") {
    return {
      OR: [{ AND: [{ NOT: hasInProgress }, hasDone] }, noConstructionFallback],
    };
  }
  // not_started: 施工はあるが進行中も完了も無い（= REQUEST_PENDING のみ）か、施工 0 件で列が未着手。
  return {
    OR: [
      { AND: [hasAnyConstruction, { NOT: hasInProgress }, { NOT: hasDone }] },
      noConstructionFallback,
    ],
  };
}

function buildStatusWhere(filter: CustomerListFilter): Prisma.CustomerWhereInput[] {
  const clauses: Prisma.CustomerWhereInput[] = [];

  // 契約 / 設置申請 are manual columns → direct equality.
  if (filter.contractStatus) clauses.push({ contractStatus: filter.contractStatus });
  // 施工状況は代表施工から導出（施工 0 件は Customer 列フォールバック）。
  if (filter.constructionStatus) {
    clauses.push(buildConstructionStatusWhere(filter.constructionStatus));
  }
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

    // Free-text search matches the customer name only (partial, case-insensitive).
    // Assignee is filtered separately via the dedicated assignee dropdown.
    const nameClause: Prisma.CustomerWhereInput | null = queryStr
      ? { name: { contains: queryStr, mode: "insensitive" } }
      : null;

    const where: Prisma.CustomerWhereInput = {
      ...(nameClause ?? {}),
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

    // 施工状況は代表施工から導出（固定優先順位: 進行中 > 完了 > 未着工）。顧客の全 Construction を
    // contracts 経由で 1 クエリにまとめて取得（N+1 回避）し、customerId ごとに集約する。
    // RLS スコープ内（contract.customerId in の相関）で越境しない。
    const constructionRows = await tx.construction.findMany({
      where: { contract: { customerId: { in: customerIds } } },
      select: { status: true, contract: { select: { customerId: true } } },
    });
    const constructionsByCustomer = new Map<string, { status: string }[]>();
    for (const con of constructionRows) {
      const cid = con.contract.customerId;
      const list = constructionsByCustomer.get(cid) ?? [];
      list.push({ status: con.status });
      constructionsByCustomer.set(cid, list);
    }

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
          // 代表施工から導出。施工 0 件は Customer.constructionStatus フォールバック。
          constructionStatus: deriveConstructionStatusValue(
            constructionsByCustomer.get(r.id) ?? [],
            r.constructionStatus as ConstructionStatusValue,
          ),
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
