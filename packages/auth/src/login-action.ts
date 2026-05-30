// Server Action helper that wraps Auth.js v5's `signIn` so the calling page
// (S-001 sign-in) can render LockedError details (countdown) and Suspended /
// Invited statuses with distinct UI states.
//
// This is the **only** entry point that hits the login pipeline. It runs in
// two stages:
//   1. `probeLock(email)` — READ-only check for the 15-min lockout window.
//      Returns immediately with `status: "LOCKED"` if the threshold is hit
//      WITHOUT writing a LoginAttempt row.
//   2. `signIn('credentials', { email, password, ip, redirect: false })` —
//      drives Auth.js's `authorize()` → `verifyPassword()` path which is the
//      single source of truth for LoginAttempt INSERTs. Without this split
//      every call would double-write LoginAttempt and the 5-failure lock
//      would trip at 2.5 real attempts.
//
// `signIn` is created in `apps/web/auth.ts` via `NextAuth(authConfig)` and
// cannot be imported from `@solar/auth` (cyclic). The Server Action wrapper
// in `apps/web/app/(auth)/login/actions.ts` therefore injects it:
//
//   "use server";
//   import { headers } from "next/headers";
//   import { loginAction } from "@solar/auth";
//   import { signIn } from "@/auth";
//   export async function loginFromForm(formData: FormData) {
//     const h = await headers();
//     const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim()
//       ?? h.get("x-real-ip")
//       ?? "0.0.0.0";
//     return loginAction(
//       {
//         email: String(formData.get("email") ?? ""),
//         password: String(formData.get("password") ?? ""),
//         ip,
//       },
//       { signIn },
//     );
//   }

import { z } from "zod";

import { probeLock } from "./auth-service.js";

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
  /**
   * Client IP captured from request headers in the Server Action layer
   * (`x-forwarded-for` / `x-real-ip`). Required by docs/05 §6.10 step 4 so the
   * LoginAttempt row records the real source. Pass `"0.0.0.0"` only when the
   * header is genuinely missing (Railway edge / CF should always populate it).
   */
  ip: z.string().min(1).max(64),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

export type LoginActionResult =
  | {
      status: "OK";
    }
  | {
      status: "INVALID_CREDENTIALS";
    }
  | {
      status: "LOCKED";
      lockedUntil: string; // ISO timestamp for S-006 countdown
    }
  | {
      status: "USER_SUSPENDED" | "USER_INVITED";
    };

/**
 * Shape of the injected `signIn` from `next-auth` (re-exported by
 * `apps/web/auth.ts`). We accept a structural type rather than importing the
 * concrete export to keep `@solar/auth` decoupled from `apps/web` and from
 * `next-auth`'s server-only entry (which transitively pulls `next/headers`
 * and breaks Vitest's worker runtime).
 */
export type SignInFn = (
  provider: "credentials",
  options: { email: string; password: string; ip: string; redirect: false },
) => Promise<unknown>;

export interface LoginActionDeps {
  signIn: SignInFn;
}

/**
 * Validates credentials and returns a discriminated union the UI layer can
 * switch on. The injected `signIn` is the only path that writes LoginAttempt.
 */
export async function loginAction(
  rawInput: LoginInput,
  deps: LoginActionDeps,
): Promise<LoginActionResult> {
  const parsed = loginInputSchema.safeParse(rawInput);
  if (!parsed.success) return { status: "INVALID_CREDENTIALS" };

  // Stage 1: read-only lock probe. Returns immediately when the email is
  // already locked WITHOUT inserting a LoginAttempt row — otherwise every
  // page render that hits S-006 would tick the counter further.
  const lock = await probeLock(parsed.data.email);
  if (lock.locked && lock.lockedUntil) {
    return { status: "LOCKED", lockedUntil: lock.lockedUntil.toISOString() };
  }

  // Stage 2: delegate to Auth.js. The provider's `authorize()` calls
  // `verifyPassword()` — the single LoginAttempt writer. We pass `ip` through
  // credentials so `authorize()` doesn't have to re-extract it from headers
  // (and so RSC/unit tests where `request.headers` is empty still record the
  // correct value).
  try {
    await deps.signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      ip: parsed.data.ip,
      redirect: false,
    });
  } catch (err) {
    // Auth.js v5 surfaces failures via `CredentialsSignin` / `AuthError`
    // subclasses. We cannot reliably distinguish bad credentials from
    // suspended / invited users at this layer (authorize() collapses them to
    // `return null`), so we re-probe the lock state to surface LOCKED in the
    // rare case where the failed attempt we just made was the 5th — and fall
    // back to INVALID_CREDENTIALS otherwise. USER_SUSPENDED / USER_INVITED is
    // returned only if a follow-up probe / lookup confirms the case; for
    // now we keep parity with the previous contract by collapsing.
    void err;
    const after = await probeLock(parsed.data.email);
    if (after.locked && after.lockedUntil) {
      return { status: "LOCKED", lockedUntil: after.lockedUntil.toISOString() };
    }
    return { status: "INVALID_CREDENTIALS" };
  }

  return { status: "OK" };
}
