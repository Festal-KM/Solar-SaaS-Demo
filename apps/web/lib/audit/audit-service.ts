// AuditService — T-07-08 / F-055 / docs/05 §6.9.
//
// `recordAudit(tx, input)` inserts one AuditLog row inside the caller's
// already-open withTenant transaction.  The insert uses the same tx so it
// commits or rolls back atomically with the surrounding business write.
//
// PII redact: any key named `phone`, `address`, or `name` (exact, case-sensitive)
// at the top level of `before` / `after` JSON is replaced with "***" before
// storing.  This satisfies CLAUDE.md Hard Rule #6 and docs/02 §5.7 (audit logs
// must not contain full PII).
//
// The `tenantId` field is always required so audit rows are partitioned by tenant
// and never cross RLS boundaries.

import type { TxClient } from "@solar/db";
import type { AuditAction } from "@solar/db";

// Fields that must be redacted wherever they appear at the top level of
// a before/after JSON object.  Extend here if additional PII fields are added.
const PII_KEYS = new Set(["phone", "address", "name"]);

export interface RecordAuditInput {
  /** The user performing the action (null = system/background job). */
  actorUserId: string | null;
  action: AuditAction;
  /** Model name, e.g. "Contract", "Product", "MonthlyReport". */
  targetType: string;
  targetId: string;
  /** Snapshot of the row before the mutation (optional). */
  before?: Record<string, unknown> | null;
  /** Snapshot of the row after the mutation (optional). */
  after?: Record<string, unknown> | null;
  /** Tenant this audit record belongs to. */
  tenantId: string;
  /** Originating IP address (Server Action / Route Handler should pass this). */
  ip?: string;
  /** Raw User-Agent string from the HTTP request. */
  userAgent?: string;
}

/**
 * Redact known PII keys at the top level of a plain JSON object.
 *
 * Returns a new object; the original is not mutated.
 */
export function redactPii(
  obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = PII_KEYS.has(key) ? "***" : value;
  }
  return out;
}

/**
 * Insert one AuditLog row inside an active withTenant transaction.
 *
 * The function is intentionally fire-and-forget from the caller's perspective:
 * if the broader transaction rolls back, this insert rolls back too.
 */
export async function recordAudit(
  tx: TxClient,
  input: RecordAuditInput,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      before: input.before ? (redactPii(input.before) as object) : undefined,
      after: input.after ? (redactPii(input.after) as object) : undefined,
      ip: input.ip,
      userAgent: input.userAgent,
    },
  });
}
