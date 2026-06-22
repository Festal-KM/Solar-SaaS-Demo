// Next.js middleware — request id issuance (T-01-11, docs/05 §10.1).
//
// Every request gets an `x-request-id` header so downstream Route Handlers /
// Server Actions / pino logs can correlate. If the caller already supplied
// one (e.g. a load balancer or Sentry frontend) we honor it.
//
// SP-01 scope: only stamp the header. Actually wrapping each handler in
// `withRequestContext()` so `getLogger()` auto-binds the id is wired in
// SP-02 (alongside the auth-aware handler factory). The header itself is
// already useful — UptimeRobot / curl users can include it in support
// tickets, and the worker propagates it through job payloads.
//
// Why Edge is fine here: AsyncLocalStorage is **not** used in the middleware
// itself, only crypto.randomUUID (web crypto) and Headers manipulation —
// both available on the Edge runtime. The downstream wrap will run in Node
// (Route Handler / Server Action default).

import { NextResponse, type NextRequest } from "next/server";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9-_]{8,128}$/;

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/reset", "/invite", "/api/auth", "/api/health"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const inbound = req.headers.get(REQUEST_ID_HEADER);
  const requestId = inbound && REQUEST_ID_PATTERN.test(inbound) ? inbound : crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  // Auth guard: check for session cookie (Edge-safe, no native modules)
  if (!isPublicPath(pathname)) {
    const hasSession =
      req.cookies.has("authjs.session-token") ||
      req.cookies.has("__Secure-authjs.session-token");
    if (!hasSession) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      const redirectRes = NextResponse.redirect(loginUrl);
      redirectRes.headers.set(REQUEST_ID_HEADER, requestId);
      return redirectRes;
    }
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

// Skip static assets / internal Next paths. `api/auth/*` is Auth.js — we
// still want a request id there for login-failure debugging.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|webmanifest)$).*)"],
};
