// Sentry — Edge runtime initialization (T-01-11). Loaded via
// `instrumentation.ts` when the runtime is "edge". Server-rendered routes
// that opt into the Edge runtime (none today, but middleware *was* edge by
// default in older Next.js versions) will trip this path.

import * as Sentry from "@sentry/nextjs";

import { sentryBeforeSend } from "@/lib/sentry/pii-filter";

const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";

if (!dsn) {
  console.warn("[sentry] SENTRY_DSN is not set — edge-runtime Sentry disabled.");
} else {
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 0.1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeSend: sentryBeforeSend as any,
  });
}
