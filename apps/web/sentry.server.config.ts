// Sentry — Node.js (server) initialization (T-01-11, docs/03 §4.11,
// docs/05 §10.3).
//
// Loaded via `instrumentation.ts` when the runtime is "nodejs". DSN is read
// from env: if absent we no-op (with a single warn) so local / CI runs
// without Sentry credentials don't crash the build or boot.

import * as Sentry from "@sentry/nextjs";

import { sentryBeforeSend } from "@/lib/sentry/pii-filter";

const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";

if (!dsn) {
  // Single boot-time warning rather than logging on every request.
  console.warn("[sentry] SENTRY_DSN is not set — server-side Sentry disabled.");
} else {
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 0.1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeSend: sentryBeforeSend as any,
  });
}
