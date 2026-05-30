"use client";

// S-009/S-010 — Dealer self-signup step 2: company + admin account (F-007).
//
// Reads the invite code from sessionStorage (set by /signup). If missing,
// redirects back to /signup. On successful submit navigates to /login.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

export default function SignupRegisterPage() {
  const t = labels.auth.signup;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    const code = sessionStorage.getItem("solar_invite_code");
    if (!code) {
      router.replace("/signup");
    } else {
      setInviteCode(code);
    }
  }, [router]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!companyName.trim()) {
      setError(t.errors.companyNameRequired);
      return;
    }
    if (!adminEmail.trim()) {
      setError(t.errors.adminEmailRequired);
      return;
    }
    if (!adminName.trim()) {
      setError(t.errors.adminNameRequired);
      return;
    }
    if (password.length < 8) {
      setError(t.errors.passwordMinLength);
      return;
    }
    if (password !== confirm) {
      setError(t.errors.passwordMismatch);
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inviteCode,
            companyName,
            adminEmail,
            adminName,
            password,
          }),
        });

        if (res.ok) {
          sessionStorage.removeItem("solar_invite_code");
          setDone(true);
        } else {
          const data = await res.json().catch(() => ({}));
          if (data?.error === "invalid_invite_code") {
            setError(t.errors.invalidCode);
          } else if (data?.error === "invite_code_exhausted") {
            setError(t.errors.codeExhausted);
          } else if (data?.error === "email_already_exists") {
            setError(t.errors.emailAlreadyExists);
          } else if (data?.issues) {
            setError(t.errors.validationError);
          } else {
            setError(t.errors.unknownError);
          }
        }
      } catch {
        setError(t.errors.unknownError);
      }
    });
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t.successTitle}</h1>
        <p className="text-muted-foreground text-sm">{t.successBody}</p>
        <Link
          href="/login"
          className="text-primary text-sm underline-offset-4 hover:underline"
        >
          {t.backToSignIn}
        </Link>
      </div>
    );
  }

  if (!inviteCode) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t.registerTitle}</h1>
        <p className="text-muted-foreground text-sm">{t.registerSubtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t.sectionCompany}</legend>

          <div className="space-y-2">
            <Label htmlFor="company-name">{t.companyNameLabel}</Label>
            <Input
              id="company-name"
              type="text"
              autoComplete="organization"
              placeholder={t.companyNamePlaceholder}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={pending}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t.sectionAdmin}</legend>

          <div className="space-y-2">
            <Label htmlFor="admin-name">{t.adminNameLabel}</Label>
            <Input
              id="admin-name"
              type="text"
              autoComplete="name"
              placeholder={t.adminNamePlaceholder}
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-email">{t.adminEmailLabel}</Label>
            <Input
              id="admin-email"
              type="email"
              autoComplete="email"
              placeholder={t.adminEmailPlaceholder}
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t.passwordLabel}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder={t.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">{t.confirmPasswordLabel}</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              placeholder={t.confirmPasswordPlaceholder}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={pending}
            />
          </div>
        </fieldset>

        {error ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t.submitting : t.registerSubmitButton}
        </Button>
      </form>

      <div className="text-center text-sm">
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => router.push("/signup")}
        >
          {t.backToCodeEntry}
        </button>
      </div>
    </div>
  );
}
