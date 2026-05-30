// Shared structured logger + per-request context (T-01-11, docs/03 §4.11,
// docs/05 §10.1).
//
// We standardise on a single `pino` instance so every layer — web Route
// Handlers, Server Actions, the worker process, domain services — emits the
// same JSON shape into Railway logs. A request-scoped `AsyncLocalStorage`
// threads a `requestId` (and any later additions such as `userId`,
// `wholesalerId`) through async boundaries without each caller having to
// pass it explicitly. `getLogger()` automatically attaches whatever context
// is on the stack at the call site.
//
// PII redaction (docs/05 §10.1) is configured via pino's `redact` paths so
// even mistakes in business code can't leak `phone`, `email`, etc. Sentry
// `beforeSend` PII filtering is a separate concern (TODO in SP-07).
//
// The `pino-pretty` transport is **dev-only**. In production we emit raw
// JSON straight to stdout so Railway / Logflare / BetterStack can parse it
// without an extra dependency.

import { AsyncLocalStorage } from "node:async_hooks";

import { pino, type Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

export interface RequestContext {
  requestId: string;
  userId?: string;
  tenantId?: string;
  wholesalerId?: string;
}

/**
 * Per-request context store. Populate it at the request boundary
 * (middleware, route handler, server action wrapper, or job runner) via
 * `withRequestContext()`. Reads via `getRequestContext()` are safe outside
 * a scope and return `undefined`.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Run `fn` inside a request-scoped context. Nested calls overlay their
 * fields on top of the parent context (last write wins per key).
 */
export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  const parent = requestContextStorage.getStore();
  const merged: RequestContext = parent ? { ...parent, ...ctx } : ctx;
  return requestContextStorage.run(merged, fn);
}

function resolveLevel(): string {
  const raw = process.env.LOG_LEVEL?.trim();
  if (raw && raw.length > 0) return raw;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function shouldPrettyPrint(): boolean {
  // pino-pretty is a devDependency — never load it in production or test
  // (Vitest captures stdout, and the transport thread is overkill).
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.NODE_ENV === "test") return false;
  if (process.env.LOG_PRETTY === "false") return false;
  // Next.js dev mode tears down + re-creates modules across HMR boundaries,
  // which orphans the pino-pretty worker thread and crashes the next log
  // write with "the worker has exited". Default to JSON inside Next.js
  // unless the operator explicitly opts in via LOG_PRETTY=true.
  if (process.env.NEXT_RUNTIME && process.env.LOG_PRETTY !== "true") return false;
  return true;
}

// docs/05 §10.1 redact paths. Wildcards cover nested log payloads regardless
// of which service emits them.
const REDACT_PATHS = [
  "password",
  "passwordHash",
  "token",
  "tokenHash",
  "secret",
  "totpSecret",
  "backupCode",
  // Top-level PII fields (CLAUDE.md Hard Rule #6, docs/05 §10.1).
  "phone",
  "address",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.tokenHash",
  "*.secret",
  "*.totpSecret",
  "*.phone",
  "*.email",
  "*.address",
  "*.snapshotPurchasePrice",
];

function buildBaseLogger(): Logger {
  const level = resolveLevel();
  if (shouldPrettyPrint()) {
    return pino({
      level,
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      },
    });
  }
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

// Hot-reload friendly singleton. Avoids spawning a new pino-pretty worker
// thread every time Next.js / tsx re-evaluates a module.
declare global {
  var __solarBaseLogger: Logger | undefined;
}

const baseLogger: Logger = globalThis.__solarBaseLogger ?? buildBaseLogger();
if (process.env.NODE_ENV !== "production") {
  globalThis.__solarBaseLogger = baseLogger;
}

/**
 * Return a logger bound to the current `RequestContext` (if any). Outside a
 * request scope this returns the base logger.
 *
 * Prefer this over importing `baseLogger` directly so that `request_id` is
 * always emitted when one exists.
 */
export function getLogger(bindings?: Record<string, unknown>): Logger {
  const ctx = requestContextStorage.getStore();
  if (!ctx && !bindings) return baseLogger;
  const merged: Record<string, unknown> = {};
  if (ctx) {
    merged.request_id = ctx.requestId;
    if (ctx.userId) merged.user_id = ctx.userId;
    if (ctx.tenantId) merged.tenant_id = ctx.tenantId;
    if (ctx.wholesalerId) merged.wholesaler_id = ctx.wholesalerId;
  }
  if (bindings) Object.assign(merged, bindings);
  return baseLogger.child(merged);
}

/**
 * Direct access to the un-childed base logger. Only use this for bootstrap
 * messages (e.g. worker process startup banner) where a request context
 * does not exist.
 */
export const logger: Logger = baseLogger;
