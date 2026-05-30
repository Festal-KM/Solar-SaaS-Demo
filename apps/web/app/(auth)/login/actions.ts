"use server";

import { loginAction, type LoginActionResult } from "@solar/auth";
import { headers } from "next/headers";

import { signIn } from "@/auth";

export interface SignInActionState {
  status: LoginActionResult["status"] | "IDLE" | "ERROR";
  lockedUntil?: string;
}

export async function signInAction(
  _prev: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "0.0.0.0";

  try {
    const result = await loginAction(
      {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        ip,
      },
      { signIn },
    );

    if (result.status === "LOCKED") {
      return { status: "LOCKED", lockedUntil: result.lockedUntil };
    }
    return { status: result.status };
  } catch {
    return { status: "ERROR" };
  }
}
