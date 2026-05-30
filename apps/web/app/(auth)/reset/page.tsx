"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

export default function PasswordResetRequestPage() {
  const t = labels.passwordReset;
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError(t.errors.emailRequired);
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/password-reset/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (res.ok || res.status === 404) {
          // Always show success to avoid email enumeration
          setSent(true);
        } else {
          setError(t.errors.unknownError);
        }
      } catch {
        setError(t.errors.unknownError);
      }
    });
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t.sentTitle}</h1>
        <p className="text-muted-foreground text-sm">{t.sentBody}</p>
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
        <h1 className="text-2xl font-semibold tracking-tight">{t.requestTitle}</h1>
        <p className="text-muted-foreground text-sm">{t.requestSubtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">{t.emailLabel}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
          />
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t.submitting : t.submitButton}
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
