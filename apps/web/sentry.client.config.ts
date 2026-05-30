// Sentry — browser initialization (T-01-11, docs/03 §4.11, docs/05 §10.3).
//
// On the client we read the DSN from `NEXT_PUBLIC_SENTRY_DSN` (Next.js
// inlines variables prefixed with `NEXT_PUBLIC_` at build time). If
// unspecified we no-op silently — local dev frequently runs without a DSN
// and we don't want console noise on every page load.
//
// MVP transport tuning (docs/05 §10):
//   - tracesSampleRate 0.1  → 10% of nav transactions
//   - replaysSessionSampleRate 0  → Session Replay disabled (privacy + cost)

import * as Sentry from "@sentry/nextjs";

import { sentryBeforeSend } from "@/lib/sentry/pii-filter";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeSend: sentryBeforeSend as any,
  });
}
