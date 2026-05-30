// @solar/auth — Auth.js v5 + Credentials + argon2id (T-01-05) + TOTP 2FA (T-01-06).
//
// Public exports:
//   - `authConfig`             — Auth.js v5 NextAuthConfig (consumed by apps/web/auth.ts)
//   - `verifyPassword`         — docs/05 §6.10 four-step login pipeline
//   - `bumpSessionVersion`     — forced-logout marker
//   - `hashPassword`           — argon2id helper for invite / reset flows (T-01-07)
//   - `loginAction`            — Server Action helper for S-001
//   - `generateTotpSetup` / `activateTotp` / `verifyTotpCode` /
//     `regenerateBackupCodes`  — TOTP service primitives
//   - `setupTotpAction` / `verifyTotpAction` / `regenerateBackupCodesAction` —
//      Server Action wrappers
//   - `UnauthorizedError` / `LockedError` — error contract
//
// NOTE: `encryptTotpSecret` / `decryptTotpSecret` are intentionally NOT
// re-exported. They are internal to the TotpService — callers MUST go through
// the public action surface so the PII_ENCRYPTION_KEY usage stays auditable.

export { authConfig } from "./config.js";
export {
  verifyPassword,
  probeLock,
  bumpSessionVersion,
  type VerifyPasswordInput,
  type VerifyPasswordResult,
  type VerifiedUser,
  type LockProbeResult,
} from "./auth-service.js";
export { hashPassword } from "./password.js";
export {
  loginAction,
  loginInputSchema,
  type LoginInput,
  type LoginActionResult,
  type LoginActionDeps,
  type SignInFn,
} from "./login-action.js";
export {
  generateTotpSetup,
  activateTotp,
  verifyTotpCode,
  regenerateBackupCodes,
  type GenerateTotpSetupResult,
  type ActivateTotpResult,
  type VerifyTotpResult,
  type RegenerateBackupCodesResult,
} from "./totp.js";
export {
  setupTotpAction,
  verifyTotpAction,
  regenerateBackupCodesAction,
  type SetupTotpActionResult,
  type RegenerateBackupCodesActionInput,
  type RegenerateBackupCodesActionResult,
} from "./totp-actions.js";
export { UnauthorizedError, LockedError, type UnauthorizedReason } from "./errors.js";
export type { SolarSessionUser } from "./session-types.js";
export {
  requestPasswordResetAction,
  resetPasswordAction,
  requestPasswordResetInputSchema,
  resetPasswordInputSchema,
  PASSWORD_RESET_TTL_MINUTES,
  type RequestPasswordResetInput,
  type ResetPasswordInput,
  type PasswordResetDeps,
} from "./password-reset.js";
export {
  createInviteCode,
  consumeInviteCode,
  acceptUserInviteAction,
  issueUserInvitation,
  acceptUserInviteInputSchema,
  INVITE_CODE_PATTERN,
  type CreateInviteCodeInput,
  type CreateInviteCodeResult,
  type AcceptUserInviteInput,
  type AcceptUserInviteResult,
  type IssueUserInvitationInput,
  type IssueUserInvitationResult,
} from "./invite.js";
