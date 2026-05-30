// User invitations + organisation invite codes — F-006 / F-008, docs/05 §6.10.
//
// Two flows:
//
//   `createInviteCode({ wholesalerId, maxUses, expiresAt, createdBy })`
//     - Issues a 16-char human-readable code (`SOLAR-XXXX-YYYY` shape) for a
//       wholesaler to hand to a partner dealer organisation. The plaintext
//       code is returned ONCE to the operator; the DB only persists an
//       argon2id hash on `InviteCode.codeHash`. Validation of the code at
//       use time is via argon2 verify against every active candidate row,
//       same approach as backup codes / password reset.
//     - Used to bootstrap dealer signup (`signupDealerAction` in §4.3). The
//       caller (Server Action `inviteUserAction` or seed script) is
//       responsible for `assertCan(WHOLESALER_ADMIN)`.
//
//   `acceptUserInviteAction({ token, name, password, totpEnable })`
//     - Consumes a per-user `UserInvitation` row. The `token` is the
//       plaintext form embedded in the email link; `UserInvitation.tokenHash`
//       holds the argon2 hash. On success: creates the User (or activates an
//       existing INVITED placeholder), assigns the role from the invitation,
//       stamps `acceptedAt`, and writes an AuditLog.
//     - Returns `{ userId }`. The caller (page Server Action) drives
//       Auth.js's `signIn` to log the new user in.
//
// Both paths run under SYSTEM_TENANT_CONTEXT because the caller is not yet
// signed in at acceptance time, and `createInviteCode` runs from a wholesaler
// admin's Server Action which is already authenticated but the resulting
// InviteCode lookup later happens unauth'd.

import { randomBytes } from "node:crypto";

import { SYSTEM_TENANT_CONTEXT, withTenant, type AppRole } from "@solar/db";
import { z } from "zod";

import { UnauthorizedError } from "./errors.js";
import { hashPassword, verifyArgon2 } from "./password.js";

const INVITE_CODE_BYTES = 6; // 12 hex chars → SOLAR-XXXX-YYYY (8 visible hex + dashes)
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

// ---------------------------------------------------------------------------
// `createInviteCode` — wholesaler-issued organisation invitation code.
// ---------------------------------------------------------------------------

export interface CreateInviteCodeInput {
  wholesalerId: string;
  createdBy: string;
  maxUses?: number;
  expiresAt: Date;
}

export interface CreateInviteCodeResult {
  code: string;
  inviteCodeId: string;
}

/**
 * Issue a fresh invite code on the given wholesaler tenant. The plaintext
 * code is returned exactly once — store-and-display contracts are the
 * caller's responsibility.
 */
export async function createInviteCode(
  input: CreateInviteCodeInput,
): Promise<CreateInviteCodeResult> {
  if (!input.wholesalerId) throw new Error("createInviteCode: wholesalerId is required");
  if (!input.createdBy) throw new Error("createInviteCode: createdBy is required");
  if (!input.expiresAt || input.expiresAt.getTime() <= Date.now()) {
    throw new Error("createInviteCode: expiresAt must be in the future");
  }
  const maxUses = input.maxUses ?? 1;
  if (maxUses < 1) throw new Error("createInviteCode: maxUses must be >= 1");

  const code = generateInviteCode();
  const codeHash = await hashPassword(code);

  const created = await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    return tx.inviteCode.create({
      data: {
        wholesalerId: input.wholesalerId,
        codeHash,
        expiresAt: input.expiresAt,
        maxUses,
        usedCount: 0,
        createdBy: input.createdBy,
      },
      select: { id: true },
    });
  });

  return { code, inviteCodeId: created.id };
}

/**
 * Look up + atomically consume one use of an invite code. Used by dealer
 * signup (`signupDealerAction`). Returns the wholesaler tenant id the new
 * dealer should be related to. Throws `INVITE_CODE_EXHAUSTED` on use-count
 * overflow, `INVALID_OR_EXPIRED_TOKEN` on unknown / revoked / expired codes.
 *
 * Exported so the dealer-signup flow (SP-02) can reuse the consume logic.
 */
export async function consumeInviteCode(
  code: string,
): Promise<{ wholesalerId: string; inviteCodeId: string }> {
  const normalised = code.trim();
  if (!normalised) {
    throw new UnauthorizedError({ code: "INVALID_OR_EXPIRED_TOKEN" });
  }

  return withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const now = new Date();
    const candidates = await tx.inviteCode.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true, wholesalerId: true, codeHash: true, maxUses: true, usedCount: true },
    });

    let match: (typeof candidates)[number] | null = null;
    for (const row of candidates) {
      if (await verifyArgon2(row.codeHash, normalised)) {
        match = row;
        break;
      }
    }
    if (!match) {
      throw new UnauthorizedError({ code: "INVALID_OR_EXPIRED_TOKEN" });
    }
    if (match.usedCount >= match.maxUses) {
      throw new UnauthorizedError({ code: "INVITE_CODE_EXHAUSTED" });
    }

    // Atomic CAS-ish increment: the WHERE clause re-checks usedCount so two
    // concurrent acceptors can't both pass the check above.
    const updated = await tx.inviteCode.updateMany({
      where: {
        id: match.id,
        usedCount: { lt: match.maxUses },
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedCount: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new UnauthorizedError({ code: "INVITE_CODE_EXHAUSTED" });
    }

    return { wholesalerId: match.wholesalerId, inviteCodeId: match.id };
  });
}

// ---------------------------------------------------------------------------
// `acceptUserInviteAction` — accept a per-user UserInvitation.
// ---------------------------------------------------------------------------

export const acceptUserInviteInputSchema = z.object({
  token: z.string().min(32).max(128),
  name: z.string().min(1).max(80),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  totpEnable: z.boolean().optional(),
});

export type AcceptUserInviteInput = z.infer<typeof acceptUserInviteInputSchema>;

export interface AcceptUserInviteResult {
  userId: string;
  /**
   * Whether the caller should be redirected to the TOTP setup flow next. True
   * either because `totpEnable` was requested or because the assigned role
   * mandates 2FA (`User.twoFactorRequired` is set in that case).
   */
  mfaSetupRequired: boolean;
}

const ROLES_REQUIRING_2FA: readonly AppRole[] = ["SAAS_ADMIN", "WHOLESALER_ADMIN"] as const;

/**
 * Consume a UserInvitation and provision the user. Idempotency: a UserInvitation
 * row is single-use (`acceptedAt` is set on success). Re-calling with the same
 * token throws `INVALID_OR_EXPIRED_TOKEN`.
 */
export async function acceptUserInviteAction(
  rawInput: AcceptUserInviteInput,
): Promise<AcceptUserInviteResult> {
  const parsed = acceptUserInviteInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new UnauthorizedError({ code: "INVALID_OR_EXPIRED_TOKEN" });
  }
  const { token, name, password, totpEnable } = parsed.data;

  const passwordHash = await hashPassword(password);

  return withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const now = new Date();

    // Find the candidate invitations. UserInvitation.tokenHash is unique but
    // argon2 hashes are salted, so we still must verify against every viable
    // row — typically <= 1 per invitee email since rotation is rare in MVP.
    const candidates = await tx.userInvitation.findMany({
      where: { acceptedAt: null, expiresAt: { gt: now } },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        tokenHash: true,
      },
    });

    let invitation: (typeof candidates)[number] | null = null;
    for (const row of candidates) {
      if (await verifyArgon2(row.tokenHash, token)) {
        invitation = row;
        break;
      }
    }
    if (!invitation) {
      throw new UnauthorizedError({ code: "INVALID_OR_EXPIRED_TOKEN" });
    }

    const requires2fa = ROLES_REQUIRING_2FA.includes(invitation.role) || totpEnable === true;

    // Activate an existing INVITED placeholder user if one exists (admin
    // pre-created the row when they sent the invite); otherwise create from
    // scratch. We explicitly branch on findUnique rather than upsert so we can
    // reject cross-tenant overwrites: an attacker holding a Tenant B invite
    // must NOT be able to overwrite an existing ACTIVE user owned by Tenant A
    // just by sharing the email address.
    const existing = await tx.user.findUnique({
      where: { email: invitation.email },
      select: { id: true, tenantId: true, status: true },
    });

    let user: { id: string };
    if (existing) {
      if (existing.tenantId !== invitation.tenantId || existing.status !== "INVITED") {
        throw new UnauthorizedError({ code: "INVALID_OR_EXPIRED_TOKEN" });
      }
      user = await tx.user.update({
        where: { id: existing.id },
        data: {
          name,
          passwordHash,
          status: "ACTIVE",
          twoFactorRequired: requires2fa,
        },
        select: { id: true },
      });
    } else {
      user = await tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          name,
          passwordHash,
          status: "ACTIVE",
          twoFactorRequired: requires2fa,
        },
        select: { id: true },
      });
    }

    // Idempotently grant the invitation's role. `@@id([userId, role])` makes
    // re-running on an already-roled user a no-op via `skipDuplicates`.
    await tx.userRole.createMany({
      data: [{ userId: user.id, role: invitation.role, assignedBy: invitation.id }],
      skipDuplicates: true,
    });

    await tx.userInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: now },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: invitation.tenantId,
        targetType: "User",
        targetId: user.id,
        action: "CREATE",
        after: {
          event: "USER_INVITED_ACCEPT",
          invitationId: invitation.id,
          role: invitation.role,
        },
      },
    });

    return {
      userId: user.id,
      mfaSetupRequired: requires2fa,
    };
  });
}

// ---------------------------------------------------------------------------
// `issueUserInvitation` — helper for tests + the wholesaler admin Server
// Action. Creates a UserInvitation row + returns the plaintext token.
// ---------------------------------------------------------------------------

export interface IssueUserInvitationInput {
  tenantId: string;
  email: string;
  role: AppRole;
  invitedBy: string;
  /** Defaults to 7 days when omitted (matches docs/02 §F-006 default TTL). */
  expiresAt?: Date;
}

export interface IssueUserInvitationResult {
  invitationId: string;
  token: string;
  expiresAt: Date;
}

const DEFAULT_INVITATION_TTL_DAYS = 7;

export async function issueUserInvitation(
  input: IssueUserInvitationInput,
): Promise<IssueUserInvitationResult> {
  if (!input.tenantId) throw new Error("issueUserInvitation: tenantId is required");
  if (!input.email) throw new Error("issueUserInvitation: email is required");
  if (!input.invitedBy) throw new Error("issueUserInvitation: invitedBy is required");

  const token = randomBytes(32).toString("hex");
  const tokenHash = await hashPassword(token);
  const expiresAt =
    input.expiresAt ?? new Date(Date.now() + DEFAULT_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const created = await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    return tx.userInvitation.create({
      data: {
        tenantId: input.tenantId,
        email: input.email.trim().toLowerCase(),
        role: input.role,
        tokenHash,
        expiresAt,
        invitedBy: input.invitedBy,
      },
      select: { id: true },
    });
  });

  return { invitationId: created.id, token, expiresAt };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function generateInviteCode(): string {
  // Human-readable form: `SOLAR-XXXX-YYYY` where XXXX/YYYY are 4 hex chars
  // each. Total entropy = 32 bits — sufficient given we throttle attempts
  // via the wholesaler-admin issuance gate, and brute-forcing requires an
  // argon2 verify per guess against every active row.
  const hex = randomBytes(INVITE_CODE_BYTES).toString("hex").toUpperCase();
  return `SOLAR-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

export const INVITE_CODE_PATTERN = /^SOLAR-[0-9A-F]{4}-[0-9A-F]{4}$/;
