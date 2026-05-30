"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

export default function ChangePasswordPage() {
  const t = labels.profile.passwordPage;
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!current) {
      setError(t.errors.currentRequired);
      return;
    }
    if (!newPwd) {
      setError(t.errors.newRequired);
      return;
    }
    if (newPwd.length < 8) {
      setError(t.errors.newMinLength);
      return;
    }
    if (newPwd !== confirm) {
      setError(t.errors.confirmMismatch);
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword: current, newPassword: newPwd }),
        });
        if (res.ok) {
          setSuccess(true);
        } else if (res.status === 401) {
          setError(t.errors.currentIncorrect);
        } else {
          setError(t.errors.unknownError);
        }
      } catch {
        setError(t.errors.unknownError);
      }
    });
  }

  if (success) {
    return (
      <div className="space-y-4 max-w-xl">
        <p className="text-carbon-dark font-medium">{t.success}</p>
        <Button asChild variant="outline">
          <Link href="/profile">{labels.common.back}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-medium text-carbon-dark">{t.title}</h1>
        <p className="text-pewter text-sm mt-1">{t.subtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="current-password">{t.currentLabel}</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={pending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="new-password">{t.newLabel}</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            disabled={pending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password">{t.confirmLabel}</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
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

        <div className="flex gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? t.submitting : t.submitButton}
          </Button>
          <Button asChild variant="outline" type="button">
            <Link href="/profile">{labels.common.cancel}</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
