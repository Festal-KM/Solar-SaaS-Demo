// Server-side data loader for the shift management screen (T-03-10 / F-025 /
// docs/04 §S-028). Fetches the Event header, its current EventShift rows, and
// the list of assignable users (wholesale field staff + event team).

import "server-only";

import { auth } from "@/auth";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions/can";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

export interface ShiftPageEvent {
  id: string;
  wholesalerId: string;
  mode: string;
  requiredPeople: number | null;
  status: string;
  eventCandidate: {
    storeName: string;
    scheduledDate: string;
    targetMonth: string;
    area: string | null;
  };
}

export interface ShiftRow {
  id: string;
  userId: string;
  userName: string;
  role: string;
  startPlanned: string;
  endPlanned: string;
  status: string;
}

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
}

export interface ShiftPageData {
  event: ShiftPageEvent;
  shifts: ShiftRow[];
  assignableUsers: AssignableUser[];
}

async function requireShiftCtx() {
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
    action: "event.manage_shift",
    resource: ctx.wholesalerId ? { wholesalerId: ctx.wholesalerId } : undefined,
  });
  return ctx;
}

// Roles eligible for shift assignment: wholesaler staff who participate on-site.
const ASSIGNABLE_ROLES = [
  "WHOLESALER_FIELD_STAFF",
  "WHOLESALER_EVENT_TEAM",
  "WHOLESALER_ADMIN",
  "WHOLESALER_DIRECT_SALES",
] as const;

export async function getShiftPageData(eventId: string): Promise<ShiftPageData> {
  const ctx = await requireShiftCtx();

  return withTenant(ctx, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        wholesalerId: true,
        mode: true,
        requiredPeople: true,
        status: true,
        eventCandidate: {
          select: {
            storeName: true,
            scheduledDate: true,
            targetMonth: true,
            area: true,
          },
        },
        shifts: {
          orderBy: { startPlanned: "asc" },
          select: {
            id: true,
            userId: true,
            role: true,
            startPlanned: true,
            endPlanned: true,
            status: true,
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundError("イベントが見つかりません");
    }
    if (!ctx.isSaasAdmin && ctx.wholesalerId !== event.wholesalerId) {
      throw new NotFoundError("イベントが見つかりません");
    }

    // Fetch user records for assigned shift users and assignable users in one query.
    const assignedUserIds = event.shifts.map((s) => s.userId);

    // Assignable users: wholesaler members with relevant roles.
    const userRows = await tx.user.findMany({
      where: {
        tenantId: event.wholesalerId,
        status: "ACTIVE",
        roles: {
          some: {
            role: { in: [...ASSIGNABLE_ROLES] },
          },
        },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    });

    // Also fetch any assigned-user records that might have been deactivated.
    const extraUserIds = assignedUserIds.filter((uid) => !userRows.some((u) => u.id === uid));
    const extraUsers =
      extraUserIds.length > 0
        ? await tx.user.findMany({
            where: { id: { in: extraUserIds } },
            select: { id: true, name: true, email: true },
          })
        : [];

    const userMap = new Map(
      [...userRows, ...extraUsers].map((u) => [u.id, { name: u.name, email: u.email }]),
    );

    return {
      event: {
        id: event.id,
        wholesalerId: event.wholesalerId,
        mode: event.mode,
        requiredPeople: event.requiredPeople,
        status: event.status,
        eventCandidate: {
          storeName: event.eventCandidate.storeName,
          scheduledDate: event.eventCandidate.scheduledDate.toISOString(),
          targetMonth: event.eventCandidate.targetMonth,
          area: event.eventCandidate.area,
        },
      },
      shifts: event.shifts.map((s) => {
        const user = userMap.get(s.userId);
        return {
          id: s.id,
          userId: s.userId,
          userName: user?.name ?? s.userId,
          role: s.role,
          startPlanned: s.startPlanned.toISOString(),
          endPlanned: s.endPlanned.toISOString(),
          status: s.status,
        };
      }),
      assignableUsers: userRows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
      })),
    };
  });
}
