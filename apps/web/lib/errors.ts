// Common error hierarchy for the web app (docs/05 §9.1 §9.2).
//
// Server Actions and Route Handlers throw these; `withErrorHandler` (added in
// a later sprint) maps them to ApiResult with the right HTTP status and i18n
// message code. UI surfaces translate codes via the central dictionary so no
// raw English leaks to the user.
//
// `UnauthorizedError` is re-exported from `@solar/auth` so callers can `catch`
// the exact same class regardless of whether the auth layer or the web layer
// raised it (single-identity guarantee). `@solar/auth`'s `LockedError` is the
// 401 LOCKED_TEMPORARILY login-lockout variant; this module's `ResourceLockedError`
// covers the unrelated 423 LOCKED domain case (e.g. month-end finalize lock).

export {
  UnauthorizedError,
  LockedError as TemporaryLockoutError,
  type UnauthorizedReason,
} from "@solar/auth";

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_FAILED" as const;
  readonly httpStatus = 400 as const;
}

export class BadRequestError extends AppError {
  readonly code = "BAD_REQUEST" as const;
  readonly httpStatus = 400 as const;
}

export class ForbiddenError extends AppError {
  readonly code: "FORBIDDEN" | "TENANT_ISOLATION" = "FORBIDDEN";
  readonly httpStatus = 403 as const;

  constructor(message = "この操作を実行する権限がありません", details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class TenantIsolationError extends ForbiddenError {
  override readonly code = "TENANT_ISOLATION" as const;

  constructor(message = "この情報にアクセスできません", details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  readonly httpStatus = 404 as const;

  constructor(message = "対象が見つかりません", details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class ConflictError extends AppError {
  readonly code = "CONFLICT" as const;
  readonly httpStatus = 409 as const;

  constructor(
    message = "他のユーザーが先に更新したか、編集期限を過ぎました",
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

export class ResourceLockedError extends AppError {
  readonly code = "LOCKED" as const;
  readonly httpStatus = 423 as const;
}

// 409 Conflict — F-021 二次店希望店舗回答の期限超過専用バリアント。
// ConflictError を継承し、`details.code === 'DEADLINE_PASSED'` を必ず付ける。
// UI からは `instanceof DealerPreferenceClosedError` で識別して「期限を過ぎたため
// 操作できません」専用の文言を出すために独立クラス化する (docs/05 §4.5)。
export class DealerPreferenceClosedError extends ConflictError {
  constructor(deadlineAt: Date, details?: Record<string, unknown>) {
    super("回答期限を過ぎています", {
      ...details,
      code: "DEADLINE_PASSED",
      deadlineAt: deadlineAt.toISOString(),
    });
  }
}

// 422 Unprocessable Entity — used when an input is syntactically valid (passed
// Zod) but the requested state transition is illegal for the current entity
// state. Distinct from `VALIDATION_FAILED` (400) so the UI / API surface can
// render a domain-specific message (e.g. "FIXED から CONTACTING に戻すことは
// できません"). docs/05 §9.1.
export class InvalidStateTransitionError extends AppError {
  readonly code = "INVALID_STATE_TRANSITION" as const;
  readonly httpStatus = 422 as const;

  constructor(
    message = "この状態からその状態への変更はできません",
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}
