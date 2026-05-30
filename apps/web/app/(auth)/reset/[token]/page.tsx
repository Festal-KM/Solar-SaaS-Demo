"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default function PasswordResetSetPage({ params }: PageProps) {
  const t = labels.passwordReset;
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError(t.passwordMinLength);
      return;
    }
    if (newPassword !== confirm) {
      setError(t.passwordMismatch);
      return;
    }

    startTransition(async () => {
      try {
        const { token } = await params;
        const res = await fetch("/api/auth/password-reset/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, newPassword }),
        });
        if (res.ok) {
          setDone(true);
        } else if (res.status === 400 || res.status === 404) {
          setError(t.invalidToken);
        } else {
          setError(t.errors.unknownError);
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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t.newPasswordTitle}</h1>
        <p className="text-muted-foreground text-sm">{t.newPasswordSubtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="new-password">{t.newPasswordLabel}</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            placeholder={t.newPasswordPlaceholder}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
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

        {error ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t.setting : t.setButton}
        </Button>
      </form>
    </div>
  );
}
