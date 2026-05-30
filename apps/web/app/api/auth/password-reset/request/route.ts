// POST /api/auth/password-reset/request — F-003, docs/05 §4.3.
//
// Thin Route Handler wrapper around `requestPasswordResetAction` from
// @solar/auth. Always returns 200 to prevent email-enumeration attacks.

import { type NextRequest, NextResponse } from "next/server";

import { requestPasswordResetAction } from "@solar/auth";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let email: string | undefined;
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email : undefined;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  await requestPasswordResetAction({ email: email ?? "", ip }).catch(() => {
    // Swallow errors — never reveal failure details to the caller.
  });

  return NextResponse.json({ ok: true });
}
