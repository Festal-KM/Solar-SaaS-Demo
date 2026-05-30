"use server";

import { setupTotpAction, verifyTotpAction, type SetupTotpActionResult } from "@solar/auth";
import { redirect } from "next/navigation";

import { auth, unstable_update } from "@/auth";

export interface VerifyMfaState {
  status: "IDLE" | "OK" | "INVALID" | "ERROR";
}

async function requireSessionUser() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user?.email) {
    redirect("/login");
  }
  return user;
}

export async function verifyMfaAction(
  _prev: VerifyMfaState,
  formData: FormData,
): Promise<VerifyMfaState> {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { status: "INVALID" };

  const user = await requireSessionUser();

  try {
    const result = await verifyTotpAction(user.id, code);
    if (!result.ok) {
      return { status: "INVALID" };
    }
    await unstable_update({ mfaVerified: true } as Parameters<typeof unstable_update>[0]);
    return { status: "OK" };
  } catch {
    return { status: "ERROR" };
  }
}

export async function initTotpSetupAction(): Promise<SetupTotpActionResult> {
  const user = await requireSessionUser();
  return setupTotpAction(user.id, user.email);
}

export async function completeTotpSetupAction(
  _prev: VerifyMfaState,
  formData: FormData,
): Promise<VerifyMfaState> {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { status: "INVALID" };

  const user = await requireSessionUser();

  try {
    const result = await verifyTotpAction(user.id, code);
    if (!result.ok) return { status: "INVALID" };
    await unstable_update({ mfaVerified: true } as Parameters<typeof unstable_update>[0]);
    return { status: "OK" };
  } catch {
    return { status: "ERROR" };
  }
}
