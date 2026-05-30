"use client";

// NotificationBell — header badge + link to /notifications.
//
// Polls `GET /api/notifications/unread-count` every 30 seconds.
// Shows a red badge when unreadCount > 0. Clicking navigates to /notifications.

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellIcon } from "lucide-react";

import { labels } from "@/lib/i18n/labels";

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchCount() {
      try {
        const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        if (!cancelled) {
          setUnreadCount(data.count);
        }
      } catch {
        // silently ignore — bell badge is best-effort
      }
    }

    void fetchCount();
    const timer = setInterval(() => void fetchCount(), 30_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label={
        unreadCount > 0
          ? labels.notifications.unreadCount.replace("{count}", String(unreadCount))
          : labels.notifications.bellAriaLabel
      }
      className="relative inline-flex items-center justify-center rounded-md p-2 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <BellIcon className="h-5 w-5" />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
