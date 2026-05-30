// POST /api/auth/invite/accept — F-006, docs/05 §4.3.
//
// Accepts a per-user UserInvitation: validates the token, creates/activates
// the User, assigns the role, and stamps `acceptedAt`. Delegates to
// `acceptUserInviteAction` from @solar/auth.

import { type NextRequest, NextResponse } from "next/server";

import { acceptUserInviteAction, UnauthorizedError } from "@solar/auth";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let token: string | undefined;
  let name: string | undefined;
  let password: string | undefined;
  let totpEnable: boolean | undefined;

  try {
    const body = await req.json();
    token = typeof body?.token === "string" ? body.token : undefined;
    name = typeof body?.name === "string" ? body.name : undefined;
    password = typeof body?.password === "string" ? body.password : undefined;
    totpEnable = typeof body?.totpEnable === "boolean" ? body.totpEnable : undefined;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!token || !name || !password) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await acceptUserInviteAction({ token, name, password, totpEnable });
    return NextResponse.json({ ok: true, userId: result.userId, mfaSetupRequired: result.mfaSetupRequired });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 400 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
