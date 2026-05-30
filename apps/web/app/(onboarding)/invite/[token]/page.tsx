"use client";

// S-007 — Invite acceptance page (F-006).
//
// Reads the plaintext token from params, shows a form for name + password.
// On submit calls POST /api/auth/invite/accept. On success redirects to
// /login so the new user can sign in immediately.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default function InviteAcceptPage({ params }: PageProps) {
  const { token } = use(params);
  const t = labels.auth.invite;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError(t.errors.nameRequired);
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
        const res = await fetch("/api/auth/invite/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, name, password }),
        });
        if (res.ok) {
          router.push("/login");
        } else {
          const data = await res.json().catch(() => ({}));
          if (data?.error === "invalid_or_expired_token") {
            setError(t.errors.invalidToken);
          } else {
            setError(t.errors.unknownError);
          }
        }
      } catch {
        setError(t.errors.unknownError);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.subtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="name">{t.nameLabel}</Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            placeholder={t.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
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
