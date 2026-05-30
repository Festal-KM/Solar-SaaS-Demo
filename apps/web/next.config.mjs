/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  transpilePackages: [
    "@solar/auth",
    "@solar/contracts",
    "@solar/db",
    "@solar/email",
    "@solar/storage",
    "@solar/ui",
  ],
  // Native / heavy server-only deps that must NOT be bundled by webpack.
  // `argon2` is a node-gyp addon and `@prisma/client` ships its own runtime.
  // `pino` + `pino-pretty` rely on worker_threads / fs and can be left as
  // externals so webpack does not try to inline the transport.
  serverExternalPackages: [
    "argon2",
    "@prisma/client",
    "prisma",
    "@node-rs/argon2",
    "pino",
    "pino-pretty",
  ],
  // The workspace packages (e.g. @solar/auth) are authored as NodeNext-style
  // ESM (relative imports carry the `.js` extension) but compiled by Next's
  // webpack from their `.ts` sources. Map `.js` → `.ts` so the bundler can
  // resolve them. We also flag the native `argon2` (node-gyp addon) as an
  // external on the server build so webpack does not try to bundle its
  // node-gyp-build dispatcher.
  webpack(config, { isServer }) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    if (isServer) {
      const existing = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : [];
      config.externals = [...existing, { argon2: "commonjs argon2" }];
    }
    return config;
  },
};

// Sentry wrapping (T-01-11).
//
// `withSentryConfig` injects the Sentry webpack plugin for source-map upload
// and rewires the build manifest for instrumentation. We only enable it when
// auth credentials are present — without them the plugin halts the build
// trying to authenticate against sentry.io. Source-map upload itself is
// gated to SP-07; for SP-01 we just want the runtime SDK + instrumentation
// hook to be live.

async function applySentry(config) {
  if (!process.env.SENTRY_DSN) {
    return config;
  }
  try {
    const mod = await import("@sentry/nextjs");
    const withSentryConfig = mod.withSentryConfig;
    const hasUploadCreds =
      Boolean(process.env.SENTRY_ORG) &&
      Boolean(process.env.SENTRY_PROJECT) &&
      Boolean(process.env.SENTRY_AUTH_TOKEN);
    return withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      // Disable source-map upload until SP-07 — it requires the auth token.
      sourcemaps: { disable: !hasUploadCreds },
      widenClientFileUpload: true,
      disableLogger: true,
      automaticVercelMonitors: false,
    });
  } catch (err) {
    // Plugin not installed yet (e.g. fresh checkout before `pnpm install`).
    // Boot without it so devs can `next dev` against a noop Sentry.
    console.warn("[next.config] @sentry/nextjs not loaded — skipping wrap:", err?.message);
    return config;
  }
}

export default await applySentry(nextConfig);
