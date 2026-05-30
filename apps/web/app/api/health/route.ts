// `/api/health` — liveness + DB readiness probe (T-01-11, docs/05 §4 §10.4).
//
// Contract:
//   - 200 OK  + { ok: true,  db: "up"   }  : web process is alive AND
//                                            Postgres responds to `SELECT 1`
//                                            within HEALTH_TIMEOUT_MS.
//   - 503     + { ok: false, db: "down", error }: web is up but DB is
//                                                  unreachable / slow.
//
// UptimeRobot is configured to alert on anything other than HTTP 200 (see
// docs/sprints/SP-01-bootstrap.md "UptimeRobot 登録手順"). 503 (not 500)
// indicates "service unavailable, retry later" — appropriate for transient
// DB blips that shouldn't page the operator if they self-heal.
//
// The DB ping goes through `rawPrisma` rather than the tenant-guarded
// `prisma` because this endpoint is intentionally tenant-less and must not
// require `withTenant()` framing. `$queryRaw\`SELECT 1\`` is the cheapest
// roundtrip Prisma exposes.
//
// We avoid Next.js caching with `dynamic = "force-dynamic"` so each probe
// truly hits the DB instead of returning a stale 200.

import * as Sentry from "@sentry/nextjs";
import { getLogger } from "@solar/contracts";
import { rawPrisma } from "@solar/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEALTH_TIMEOUT_MS = 5_000;

async function pingDb(): Promise<void> {
  const ping = rawPrisma.$queryRaw`SELECT 1`;
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`health: db ping exceeded ${HEALTH_TIMEOUT_MS}ms`)),
      HEALTH_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([ping, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? undefined;
  const log = getLogger({ route: "/api/health", request_id: requestId });

  try {
    await pingDb();
    log.debug("health ok");
    return NextResponse.json({ ok: true, db: "up" }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, "health: db ping failed");
    Sentry.captureException(err, {
      tags: { route: "/api/health", request_id: requestId ?? "unknown" },
    });
    return NextResponse.json({ ok: false, db: "down", error: message }, { status: 503 });
  }
}
