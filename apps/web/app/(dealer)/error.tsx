"use client";

// Dealer group error boundary. Mirrors `(wholesaler)/error.tsx` — maps the
// AppError taxonomy from `@/lib/errors` to a friendly 403 surface so wholesaler
// roles that wander into a /dealer/* URL see a clean message instead of a
// generic Next.js crash overlay. T-03-05 / docs/05 §9.1.

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

type ErrorBoundaryProps = {
  error: Error & { digest?: string; code?: string };
  reset: () => void;
};

export default function DealerGroupError({ error, reset }: ErrorBoundaryProps) {
  const c = labels.common;
  const isForbidden =
    error.name === "ForbiddenError" ||
    error.name === "TenantIsolationError" ||
    error.code === "FORBIDDEN" ||
    error.code === "TENANT_ISOLATION";

  if (isForbidden) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{c.forbidden}</h1>
        <p className="text-muted-foreground text-sm">{error.message || c.forbidden}</p>
        <div className="flex justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/">{c.forbiddenBack}</Link>
          </Button>
          <Button onClick={reset}>{c.back}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{c.unknownError}</h1>
      <p className="text-muted-foreground text-sm">{error.message}</p>
      <Button onClick={reset}>{c.back}</Button>
    </div>
  );
}
