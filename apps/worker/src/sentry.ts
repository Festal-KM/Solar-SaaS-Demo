// Worker-side Sentry initialization (T-01-11, docs/05 §10.3).
//
// Mirrors apps/web/sentry.server.config.ts but uses `@sentry/node` since the
// worker is a plain Node process (no Next.js framework). DSN absence is a
// warning, not a failure — local dev runs without Sentry credentials.

import * as Sentry from "@sentry/node";

import { sentryBeforeSend } from "./sentry-pii-filter.js";

let initialized = false;

export function initWorkerSentry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";

  if (!dsn) {
    console.warn("[sentry] SENTRY_DSN is not set — worker-side Sentry disabled.");
    return;
  }

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 0.1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeSend: sentryBeforeSend as any,
  });
}

export { Sentry };
