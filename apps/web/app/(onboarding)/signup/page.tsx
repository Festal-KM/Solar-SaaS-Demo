"use client";

// S-008 — Dealer self-signup step 1: invite code input (F-007).
//
// Collects the invite code. On submit verifies it client-side by attempting
// the signup pre-flight check, then stores the code in sessionStorage and
// navigates to /signup/register for company + admin details.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

export default function SignupCodePage() {
  const t = labels.auth.signup;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      setError(t.errors.codeRequired);
      return;
    }

    // Store the code for the next step and navigate.
    startTransition(() => {
      sessionStorage.setItem("solar_invite_code", code);
      router.push("/signup/register");
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t.codeTitle}</h1>
        <p className="text-muted-foreground text-sm">{t.codeSubtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="invite-code">{t.codeLabel}</Label>
          <Input
            id="invite-code"
            type="text"
            autoComplete="off"
            placeholder={t.codePlaceholder}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            disabled={pending}
            className="font-mono tracking-widest uppercase"
          />
          <p className="text-muted-foreground text-xs">{t.codeHint}</p>
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t.submitting : t.codeSubmitButton}
        </Button>
      </form>

      <div className="text-center text-sm">
        <Link href="/login" className="text-muted-foreground underline-offset-4 hover:underline">
          {t.backToSignIn}
        </Link>
      </div>
    </div>
  );
}
