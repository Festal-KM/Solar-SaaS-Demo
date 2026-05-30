import { expect, test } from "@playwright/test";

// /api/health smoke test (T-01-11).
//
// We hit the endpoint over HTTP rather than navigating in a browser so the
// assertion lines up with what UptimeRobot will be probing in production.
// A healthy local stack (docker-compose + `pnpm db:migrate dev`) is required
// for this to pass — without a reachable Postgres the route correctly
// returns 503.

test.describe("/api/health", () => {
  test("returns 200 with { ok: true, db: 'up' }", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe("up");
  });

  test("echoes x-request-id when supplied", async ({ request }) => {
    const requestId = "req-test-health-12345";
    const res = await request.get("/api/health", {
      headers: { "x-request-id": requestId },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["x-request-id"]).toBe(requestId);
  });
});
