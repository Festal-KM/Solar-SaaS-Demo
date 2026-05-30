// POST /api/auth/signup — F-007, docs/05 §4.3.
//
// Dealer self-signup: validates the invite code, then creates in one
// transaction: Tenant (DEALER), User (DEALER_ADMIN), Relationship.
//
// The invite code is argon2-verified against InviteCode rows and atomically
// consumed (usedCount increment). All DB work runs under SYSTEM_TENANT_CONTEXT
// because the caller is unauthenticated.

import { type NextRequest, NextResponse } from "next/server";

import { consumeInviteCode, hashPassword, UnauthorizedError } from "@solar/auth";
import { SYSTEM_TENANT_CONTEXT, withTenant } from "@solar/db";
import { z } from "zod";

const signupSchema = z.object({
  inviteCode: z.string().min(1).max(32),
  companyName: z.string().min(1).max(120),
  adminEmail: z.string().email().max(254),
  adminName: z.string().min(1).max(80),
  password: z.string().min(8).max(256),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  }

  const { inviteCode, companyName, adminEmail, adminName, password } = parsed.data;

  let wholesalerId: string;
  let inviteCodeId: string;
  try {
    const consumed = await consumeInviteCode(inviteCode);
    wholesalerId = consumed.wholesalerId;
    inviteCodeId = consumed.inviteCodeId;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      if (err.code === "INVITE_CODE_EXHAUSTED") {
        return NextResponse.json({ error: "invite_code_exhausted" }, { status: 409 });
      }
      return NextResponse.json({ error: "invalid_invite_code" }, { status: 400 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const passwordHash = await hashPassword(password);

  try {
    const result = await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
      // 1. Create dealer tenant.
      const tenant = await tx.tenant.create({
        data: {
          type: "DEALER",
          name: companyName,
          status: "ACTIVE",
        },
        select: { id: true },
      });

      // 2. Create dealer admin user.
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: adminEmail.trim().toLowerCase(),
          name: adminName,
          passwordHash,
          status: "ACTIVE",
          twoFactorRequired: false,
        },
        select: { id: true },
      });

      // 3. Grant DEALER_ADMIN role.
      await tx.userRole.create({
        data: {
          userId: user.id,
          role: "DEALER_ADMIN",
          assignedBy: inviteCodeId,
        },
      });

      // 4. Create relationship to the wholesaler.
      const relationship = await tx.relationship.create({
        data: {
          wholesalerId,
          dealerId: tenant.id,
          status: "ACTIVE",
          defaultScope: "FULL_CLOSING",
        },
        select: { id: true },
      });

      // 5. Audit log.
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          tenantId: tenant.id,
          targetType: "Tenant",
          targetId: tenant.id,
          action: "CREATE",
          after: {
            event: "DEALER_SELF_SIGNUP",
            wholesalerId,
            inviteCodeId,
            relationshipId: relationship.id,
          },
        },
      });

      return { tenantId: tenant.id, relationshipId: relationship.id };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Duplicate email — Prisma unique constraint violation (P2002).
    const maybeCode = (err as { code?: string }).code;
    if (maybeCode === "P2002") {
      return NextResponse.json({ error: "email_already_exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
