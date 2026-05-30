"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { labels } from "@/lib/i18n/labels";

function formatRemaining(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}分${String(s).padStart(2, "0")}秒`;
}

function LockedBody() {
  const params = useSearchParams();
  const untilRaw = params.get("until");

  const until = useMemo(() => {
    if (!untilRaw) return null;
    const d = new Date(untilRaw);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [untilRaw]);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);

  const msLeft = until ? until.getTime() - now : 0;

  return (
    <div className="space-y-4 text-center">
      <div
        role="alert"
        className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border p-4 text-sm"
      >
        <p className="font-semibold">{labels.locked.title}</p>
        <p className="text-destructive/90 mt-1">{labels.locked.body}</p>
      </div>

      {until && msLeft > 0 ? (
        <p className="text-muted-foreground text-sm">
          {labels.locked.countdownPrefix}
          <span className="text-foreground font-mono font-medium">{formatRemaining(msLeft)}</span>
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">{labels.locked.support}</p>

      <Link
        href="/login"
        className="hover:text-foreground inline-block text-sm underline underline-offset-4"
      >
        {labels.locked.backToSignIn}
      </Link>
    </div>
  );
}

export default function LockedPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">…</p>}>
      <LockedBody />
    </Suspense>
  );
}
