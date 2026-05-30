// GET /api/customers?query=&status=&channel=&contractStatus=&constructionStatus=&subsidyStatus=&page=&pageSize=
// — customer listing with pagination (T-04-07 / F-032 / docs/05 §4.7).
//
// Auth:
//   - Wholesaler roles → all customers in their wholesalerId tenant. Uses the
//     four derived-status filters (contract/construction/subsidy).
//   - Dealer roles     → only ownerRelationshipId IN ctx.relationshipIds. Keeps
//     the legacy status/channel filters.
//
// Returns: `PagedCustomerResult` (phone/address/name already masked per viewer).

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";

import { listCustomers, normalizePageSize } from "../../(wholesaler)/customers/data";
import type {
  ContractStatusValue,
  ConstructionStatusValue,
  MaekakuValue,
  SubsidyStatusValue,
} from "../../(wholesaler)/customers/data";
import { listDealerCustomers } from "../../(dealer)/d-customers/data";

import type { AcquisitionChannel, CustomerStatus } from "@solar/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: CustomerStatus[] = [
  "NEW",
  "PRE_CALL_WAIT",
  "PRE_CALL_DONE",
  "VISIT_PLANNED",
  "IN_NEGOTIATION",
  "CONTRACTED",
  "LOST",
  "IN_CONSTRUCTION",
  "COMPLETED",
];

const VALID_CHANNELS: AcquisitionChannel[] = [
  "EVENT",
  "WALK_IN",
  "TELE",
  "REFERRAL",
  "OTHER",
];

const VALID_CONTRACT: ContractStatusValue[] = ["negotiating", "contracted", "lost", "cancelled"];
const VALID_CONSTRUCTION: ConstructionStatusValue[] = ["not_started", "in_progress", "done"];
const VALID_SUBSIDY: SubsidyStatusValue[] = ["none", "applying", "granted"];
const VALID_MAEKAKU: MaekakuValue[] = ["present", "absent"];

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { code: "INVALID_CREDENTIALS", message: "サインインが必要です" },
      { status: 401 },
    );
  }

  let ctx;
  try {
    ctx = await getTenantContext();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: 401 });
    }
    throw err;
  }

  try {
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
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: 403 });
    }
    throw err;
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("query")?.trim() ?? undefined;
  const pageRaw = url.searchParams.get("page");
  const page = pageRaw ? Math.max(1, parseInt(pageRaw, 10) || 1) : 1;

  const isDealer = !!ctx.dealerId && !ctx.isSaasAdmin;

  if (isDealer) {
    const statusRaw = url.searchParams.get("status") ?? undefined;
    const channelRaw = url.searchParams.get("channel") ?? undefined;
    const status = VALID_STATUSES.includes(statusRaw as CustomerStatus)
      ? (statusRaw as CustomerStatus)
      : undefined;
    const channel = VALID_CHANNELS.includes(channelRaw as AcquisitionChannel)
      ? (channelRaw as AcquisitionChannel)
      : undefined;
    const result = await listDealerCustomers({ query, status, channel, page });
    return NextResponse.json(result);
  }

  const contractRaw = url.searchParams.get("contractStatus") ?? undefined;
  const constructionRaw = url.searchParams.get("constructionStatus") ?? undefined;
  const subsidyRaw = url.searchParams.get("subsidyStatus") ?? undefined;
  const maekakuRaw = url.searchParams.get("maekaku") ?? undefined;
  const assigneeUserId = url.searchParams.get("assigneeUserId")?.trim() || undefined;
  const pageSizeRaw = url.searchParams.get("pageSize");
  const result = await listCustomers({
    query,
    assigneeUserId,
    contractStatus: VALID_CONTRACT.includes(contractRaw as ContractStatusValue)
      ? (contractRaw as ContractStatusValue)
      : undefined,
    constructionStatus: VALID_CONSTRUCTION.includes(constructionRaw as ConstructionStatusValue)
      ? (constructionRaw as ConstructionStatusValue)
      : undefined,
    subsidyStatus: VALID_SUBSIDY.includes(subsidyRaw as SubsidyStatusValue)
      ? (subsidyRaw as SubsidyStatusValue)
      : undefined,
    maekaku: VALID_MAEKAKU.includes(maekakuRaw as MaekakuValue)
      ? (maekakuRaw as MaekakuValue)
      : undefined,
    page,
    pageSize: normalizePageSize(pageSizeRaw ? parseInt(pageSizeRaw, 10) || undefined : undefined),
  });
  return NextResponse.json(result);
}
