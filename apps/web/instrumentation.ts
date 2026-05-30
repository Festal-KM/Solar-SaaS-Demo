// Next.js 15 instrumentation hook (T-01-11).
//
// Next.js invokes `register()` exactly once per server process at startup,
// before any request hits. We dispatch to the Sentry config file appropriate
// to the runtime — the file body runs as a side-effect during dynamic
// import, calling `Sentry.init()` for that runtime.
//
// `onRequestError` is the v8+ hook for capturing Server-Action / RSC errors
// that don't naturally bubble out to the global error boundary.

import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
