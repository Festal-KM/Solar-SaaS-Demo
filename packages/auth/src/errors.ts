// Auth-layer error types — used by `verifyPassword()` and surfaced to the
// Server Action layer for HTTP-status / UI mapping (docs/05 §6.10).
//
// `UnauthorizedError`  — credentials rejected (no such user, wrong password,
//                         locked window, etc.). Maps to HTTP 401.
// `LockedError`        — 5-in-15-min lockout was tripped. Subclass of
//                         UnauthorizedError so callers can catch the broader
//                         class while still pulling `lockedUntil` off the
//                         narrower one for the S-001 countdown UI.

export type UnauthorizedReason =
  | "INVALID_CREDENTIALS"
  | "LOCKED_TEMPORARILY"
  | "USER_SUSPENDED"
  | "USER_INVITED"
  // T-01-07 — password reset + invitation tokens.
  // Single bucket for "the token you supplied is bad" covering not-found /
  // expired / already-used. We intentionally do NOT differentiate so the
  // S-005 / S-007 UI cannot be used to probe which case is which (enumeration
  // attack on user existence / token validity).
  | "INVALID_OR_EXPIRED_TOKEN"
  // InviteCode (organisation-level) has been used `maxUses` times. The
  // calling UI surfaces a distinct message ("招待コードの利用上限に達しています")
  // because the operator who issued the code needs to refresh it.
  | "INVITE_CODE_EXHAUSTED";

export interface UnauthorizedErrorOptions {
  code: UnauthorizedReason;
  message?: string;
  details?: Record<string, unknown>;
}

export class UnauthorizedError extends Error {
  readonly code: UnauthorizedReason;
  readonly httpStatus = 401 as const;
  readonly details?: Record<string, unknown>;

  constructor(opts: UnauthorizedErrorOptions) {
    super(opts.message ?? opts.code);
    this.name = "UnauthorizedError";
    this.code = opts.code;
    this.details = opts.details;
  }
}

export class LockedError extends UnauthorizedError {
  readonly lockedUntil: Date;

  constructor(lockedUntil: Date, message?: string) {
    super({
      code: "LOCKED_TEMPORARILY",
      message: message ?? "Account temporarily locked after repeated failures",
      details: { lockedUntil: lockedUntil.toISOString() },
    });
    this.name = "LockedError";
    this.lockedUntil = lockedUntil;
  }
}
