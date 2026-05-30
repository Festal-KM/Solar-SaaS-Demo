// POST /api/auth/password-reset/confirm — F-003, docs/05 §4.3.
//
// Validates reset token and replaces the user's password. Delegates entirely
// to `resetPasswordAction` from @solar/auth which handles argon2 verify,
// CAS-style token consumption, sessionVersion bump, and audit logging.

import { type NextRequest, NextResponse } from "next/server";

import { resetPasswordAction, UnauthorizedError } from "@solar/auth";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let token: string | undefined;
  let newPassword: string | undefined;
  try {
    const body = await req.json();
    token = typeof body?.token === "string" ? body.token : undefined;
    newPassword = typeof body?.newPassword === "string" ? body.newPassword : undefined;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!token || !newPassword) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    await resetPasswordAction({ token, newPassword });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 400 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
