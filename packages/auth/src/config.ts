// Auth.js v5 — Credentials provider + JWT session strategy.
//
// docs/05 §3.2 §6.10 contract:
//   - JWT session, 24 h TTL (AUTH_SESSION_MAX_AGE_SEC).
//   - `jwt` callback embeds tenantId / wholesalerId / dealerId / roles /
//      isSaasAdmin / sessionVersion at sign-in and re-validates sessionVersion
//      on every request by checking against the User row. A mismatch short-
//      circuits the JWT to `{}` so the `session` callback yields no user.
//   - `session` callback projects the JWT into `session.user`. If the JWT has
//      already been zeroed by the `jwt` callback, `token.sub` is undefined and
//      the session is returned without a `user` field, signalling unauth'd.

import {
  prisma as guardedPrisma,
  SYSTEM_TENANT_CONTEXT,
  withTenant,
  type AppRole,
  type TenantType,
} from "@solar/db";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { verifyPassword } from "./auth-service.js";

import "./session-types.js";

import type { NextAuthConfig } from "next-auth";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
  // Optional ip override: the Server Action wrapper (`loginAction`) passes the
  // client IP through credentials so server-side header extraction can be
  // bypassed in unit tests / RSC contexts where `request.headers` is empty.
  ip: z.string().optional(),
});

const SESSION_MAX_AGE_SEC = Number(process.env.AUTH_SESSION_MAX_AGE_SEC ?? 86_400);

interface SessionAttrs {
  tenantId: string;
  tenantType: TenantType;
  wholesalerId: string | null;
  dealerId: string | null;
  roles: AppRole[];
  isSaasAdmin: boolean;
}

function deriveSessionAttrs(args: {
  tenantId: string;
  tenantType: TenantType;
  roles: AppRole[];
}): SessionAttrs {
  const isSaasAdmin = args.roles.includes("SAAS_ADMIN");
  return {
    tenantId: args.tenantId,
    tenantType: args.tenantType,
    wholesalerId: args.tenantType === "WHOLESALER" ? args.tenantId : null,
    dealerId: args.tenantType === "DEALER" ? args.tenantId : null,
    roles: args.roles,
    isSaasAdmin,
  };
}

/**
 * Extract the client IP from `authorize()`'s second `Request` argument. Picks
 * the leftmost entry from `x-forwarded-for` (the original client IP behind any
 * reverse proxies), then falls back to `x-real-ip`. Returns `"0.0.0.0"` only
 * when no header is set — that case is genuinely "we can't know" and should be
 * exceedingly rare in production behind Railway / Cloudflare.
 */
function extractClientIp(request: Request | undefined): string {
  if (!request) return "0.0.0.0";
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}

/**
 * Pulls the live `sessionVersion`, roles, and tenant for a user. Returns null
 * when the user has been deleted or suspended. Used by the `jwt` and `session`
 * callbacks to invalidate stale tokens after `bumpSessionVersion()` / role
 * changes / tenant suspension.
 *
 * NOTE: this currently issues one DB read per request on every authenticated
 * call. If the live-snapshot RT becomes a bottleneck we can introduce a short
 * in-memory cache keyed by `(userId, sessionVersion)` or — preferred for
 * multi-instance deployments — a Redis cache invalidated by `bumpSessionVersion`.
 */
async function loadAuthSnapshot(userId: string): Promise<{
  sessionVersion: number;
  status: string;
  tenantId: string;
  tenantType: TenantType;
  roles: AppRole[];
  twoFactorRequired: boolean;
  totpActivated: boolean;
} | null> {
  return withTenant(SYSTEM_TENANT_CONTEXT, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { tenant: true, roles: true, totpSecret: true },
    });
    if (!user) return null;
    return {
      sessionVersion: user.sessionVersion,
      status: user.status,
      tenantId: user.tenantId,
      tenantType: user.tenant.type,
      roles: user.roles.map((r) => r.role),
      twoFactorRequired: user.twoFactorRequired,
      totpActivated: user.totpSecret?.activatedAt != null,
    };
  });
}

/**
 * Derive the two MFA flags surfaced on the session from the raw User /
 * TotpSecret state. Centralised so the `authorize` and `jwt(update)` paths
 * stay consistent.
 *
 *   `mfaSetupRequired` — the user is required to have 2FA enabled but the
 *                        TotpSecret either does not exist or has never been
 *                        activated. Middleware (T-01-08) sends them to
 *                        /mfa/setup (S-003) until this clears.
 *   `mfaVerifiedInit`  — the *initial* value the JWT carries right after
 *                        sign-in. False unless 2FA is not in use at all
 *                        (twoFactorRequired === false AND no activated TOTP)
 *                        — in which case there is nothing to challenge and we
 *                        pre-mark the session as verified so middleware lets
 *                        the user through without a /mfa stop.
 */
function deriveMfaFlags(args: { twoFactorRequired: boolean; totpActivated: boolean }): {
  mfaSetupRequired: boolean;
  mfaVerifiedInit: boolean;
} {
  const mfaSetupRequired = args.twoFactorRequired && !args.totpActivated;
  const mfaApplicable = args.twoFactorRequired || args.totpActivated;
  return {
    mfaSetupRequired,
    mfaVerifiedInit: !mfaApplicable,
  };
}

export const authConfig: NextAuthConfig = {
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SEC,
  },
  pages: {
    signIn: "/login",
  },
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        ip: { label: "IP", type: "text" },
      },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        // Source of truth for the recorded IP:
        //   1. `credentials.ip` (Server Action injects header value verbatim).
        //   2. `request.headers` (x-forwarded-for / x-real-ip).
        //   3. "0.0.0.0" sentinel when truly unknowable.
        const ip = parsed.data.ip ?? extractClientIp(request);

        try {
          const { user, sessionVersion } = await verifyPassword({
            email: parsed.data.email,
            password: parsed.data.password,
            ip,
          });
          const attrs = deriveSessionAttrs({
            tenantId: user.tenantId,
            tenantType: user.tenant.type,
            roles: user.roles.map((r) => r.role),
          });
          // MFA state at sign-in time: we need a second lookup to know whether
          // the user has an *activated* TotpSecret. verifyPassword's
          // VerifiedUser shape includes the roles + tenant joined data but
          // NOT TotpSecret (that's a separate relation and only relevant in
          // the auth layer, not on every login row read). Load it here.
          const totp = await withTenant(SYSTEM_TENANT_CONTEXT, async (tx) =>
            tx.totpSecret.findUnique({ where: { userId: user.id } }),
          );
          const mfaFlags = deriveMfaFlags({
            twoFactorRequired: user.twoFactorRequired,
            totpActivated: totp?.activatedAt != null,
          });
          // `emailVerified` is required by the Auth.js v5 AdapterUser shape
          // even though we use the JWT strategy and never persist a User row
          // via an adapter. Pass `null` to satisfy the type without claiming
          // verification.
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            emailVerified: null,
            ...attrs,
            sessionVersion,
            mfaSetupRequired: mfaFlags.mfaSetupRequired,
            mfaVerified: mfaFlags.mfaVerifiedInit,
          };
        } catch {
          // Surface all failures as a single "wrong credentials" outcome to
          // the Auth.js layer. The Server Action wrapper (login-action.ts)
          // detects LockedError vs UnauthorizedError ahead of `signIn()` via
          // `probeLock()` so the S-001 / S-006 UI can distinguish lock from
          // bad credentials without double-writing LoginAttempt.
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session: updatePayload }) {
      // Initial sign-in: copy the `authorize()` payload into the token.
      if (user) {
        const u = user as unknown as {
          id: string;
          email: string;
          name: string;
          tenantId: string;
          tenantType: TenantType;
          wholesalerId: string | null;
          dealerId: string | null;
          roles: AppRole[];
          isSaasAdmin: boolean;
          sessionVersion: number;
          mfaSetupRequired: boolean;
          mfaVerified: boolean;
        };
        token.sub = u.id;
        token.email = u.email;
        token.name = u.name;
        token.tenantId = u.tenantId;
        token.tenantType = u.tenantType;
        token.wholesalerId = u.wholesalerId;
        token.dealerId = u.dealerId;
        token.roles = u.roles;
        token.isSaasAdmin = u.isSaasAdmin;
        token.sessionVersion = u.sessionVersion;
        token.mfaSetupRequired = u.mfaSetupRequired;
        token.mfaVerified = u.mfaVerified;
        return token;
      }

      if (!token.sub) return token;

      // Subsequent requests: re-validate sessionVersion against the live row.
      // A mismatch (or missing/suspended user) zeros the JWT so the `session`
      // callback returns no user and the middleware redirects to /login.
      // This is the load-bearing forced-logout path — `bumpSessionVersion()`
      // relies on it, so the check runs on EVERY request, not just `update`.
      const snap = await loadAuthSnapshot(token.sub);
      if (!snap || snap.status !== "ACTIVE" || snap.sessionVersion !== token.sessionVersion) {
        return {};
      }

      // On explicit `update` triggers (role change, tenant move, MFA challenge
      // success, etc.) refresh the derived attrs from the snapshot we just
      // loaded. Plain reads don't mutate the JWT — saves a write per request
      // and keeps the contract that attrs only change when the caller
      // explicitly asks for it.
      if (trigger === "update") {
        const attrs = deriveSessionAttrs({
          tenantId: snap.tenantId,
          tenantType: snap.tenantType,
          roles: snap.roles,
        });
        token.tenantId = attrs.tenantId;
        token.tenantType = attrs.tenantType;
        token.wholesalerId = attrs.wholesalerId;
        token.dealerId = attrs.dealerId;
        token.roles = attrs.roles;
        token.isSaasAdmin = attrs.isSaasAdmin;
        token.sessionVersion = snap.sessionVersion;

        // `mfaSetupRequired` always reflects the live DB state — the MFA
        // setup page calls `unstable_update()` after `activateTotp` succeeds
        // to flip this without re-logging-in.
        const mfaFlags = deriveMfaFlags({
          twoFactorRequired: snap.twoFactorRequired,
          totpActivated: snap.totpActivated,
        });
        token.mfaSetupRequired = mfaFlags.mfaSetupRequired;

        // `mfaVerified` is a per-session boolean, not a DB column — the MFA
        // challenge page sets it by passing `{ mfaVerified: true }` to
        // `unstable_update()`. We accept that payload here. Anything else
        // (or a non-update trigger) leaves the current value alone.
        const payload = updatePayload as { mfaVerified?: unknown } | undefined;
        if (payload && typeof payload.mfaVerified === "boolean") {
          token.mfaVerified = payload.mfaVerified;
        }
      }

      return token;
    },
    async session({ session, token }) {
      // If the `jwt` callback zeroed the token (forced logout / suspended /
      // sessionVersion mismatch) `token.sub` is undefined — drop `user`.
      if (!token.sub) {
        return { ...session, user: undefined as never };
      }

      // `emailVerified` lives on Auth.js's `AdapterUser` and is required by
      // the framework's intersection type even though we never run a
      // database-adapter flow (JWT strategy only).
      session.user = {
        id: token.sub,
        email: token.email ?? "",
        name: token.name ?? "",
        emailVerified: null,
        tenantId: token.tenantId!,
        tenantType: token.tenantType!,
        wholesalerId: token.wholesalerId ?? null,
        dealerId: token.dealerId ?? null,
        roles: token.roles ?? [],
        isSaasAdmin: token.isSaasAdmin ?? false,
        sessionVersion: token.sessionVersion ?? 0,
        mfaSetupRequired: token.mfaSetupRequired ?? false,
        mfaVerified: token.mfaVerified ?? false,
      };
      return session;
    },
  },
};

// Convenience export for tests that need the guarded client.
export const __internal = { prisma: guardedPrisma };
