"use client";

// Wholesaler group error boundary. Maps the AppError taxonomy from
// `@/lib/errors` to a friendly fallback. ForbiddenError / TenantIsolationError
// surface as a 403-style block so dealer roles that wander into a wholesaler
// route see something better than a generic Next.js crash overlay.

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

type ErrorBoundaryProps = {
  error: Error & { digest?: string; code?: string };
  reset: () => void;
};

export default function WholesalerGroupError({ error, reset }: ErrorBoundaryProps) {
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
