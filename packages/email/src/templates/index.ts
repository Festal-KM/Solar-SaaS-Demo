// Template registry — re-export all 8 transactional email templates.

export { renderInviteUser, type InviteUserParams } from "./invite.js";
export { renderResetPassword, type ResetPasswordParams } from "./password-reset.js";
export { renderPreferenceDeadline, type PreferenceDeadlineParams } from "./preference-deadline.js";
export { renderEventDecided, type EventDecidedParams } from "./event-decided.js";
export { renderPreCallResult, type PreCallResultParams } from "./precall-result.js";
export { renderContractCreated, type ContractCreatedParams } from "./contract-created.js";
export { renderMonthlyReportSubmitted, type MonthlyReportSubmittedParams } from "./monthly-submitted.js";
export { renderMonthlyReportFinalized, type MonthlyReportFinalizedParams } from "./monthly-finalized.js";
export type { RenderedEmail } from "./invite.js";
