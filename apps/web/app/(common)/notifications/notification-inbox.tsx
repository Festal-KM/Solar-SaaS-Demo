"use client";

// NotificationInbox — client component for S-079.
//
// Features:
//   - Fetches notifications from GET /api/notifications with page + unreadOnly params.
//   - Refreshes every 30 seconds via setInterval.
//   - "未読のみ" toggle filter.
//   - Clicking a notification calls POST /api/notifications/read then re-fetches.
//   - "すべて既読" button calls POST /api/notifications/read-all.
//   - Pagination via "さらに読み込む" (appends next page).

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { labels } from "@/lib/i18n/labels";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function NotificationInbox() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPage = useCallback(
    async (p: number, unread: boolean, append: boolean) => {
      const params = new URLSearchParams({ page: String(p) });
      if (unread) params.set("unreadOnly", "true");

      try {
        const res = await fetch(`/api/notifications?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!append) toast.error(labels.notifications.errors.loadFailed);
          return;
        }
        const data = (await res.json()) as NotificationsResponse;
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setItems((prev) => (append ? [...prev, ...data.notifications] : data.notifications));
      } catch {
        if (!append) toast.error(labels.notifications.errors.loadFailed);
      }
    },
    [],
  );

  // Initial load + polling
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      await fetchPage(1, unreadOnly, false);
      if (!cancelled) {
        setPage(1);
        setLoading(false);
      }
    }

    void load();

    pollingRef.current = setInterval(() => {
      void fetchPage(1, unreadOnly, false).then(() => setPage(1));
    }, 30_000);

    return () => {
      cancelled = true;
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  const handleLoadMore = async () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    await fetchPage(nextPage, unreadOnly, true);
    setPage(nextPage);
    setLoadingMore(false);
  };

  const handleMarkRead = async (id: string) => {
    try {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: id }),
      });
      if (!res.ok) {
        toast.error(labels.notifications.errors.markReadFailed);
        return;
      }
      // Optimistic update
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
    } catch {
      toast.error(labels.notifications.errors.markReadFailed);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) {
        toast.error(labels.notifications.errors.markReadFailed);
        return;
      }
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
      toast.success(labels.notifications.markAllReadDone);
    } catch {
      toast.error(labels.notifications.errors.markReadFailed);
    }
  };

  const hasMore = page < totalPages;
  const isEmpty = !loading && items.length === 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          {labels.notifications.filterUnreadOnly}
        </label>
        <Button variant="outline" size="sm" onClick={() => void handleMarkAllRead()}>
          {labels.notifications.markAllRead}
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          {labels.notifications.loading}
        </div>
      ) : isEmpty ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          {unreadOnly ? labels.notifications.emptyUnreadOnly : labels.notifications.empty}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((n) => (
            <li
              key={n.id}
              className={cn(
                "flex items-start gap-3 px-4 py-3 transition-colors",
                n.readAt == null ? "bg-muted/30" : "bg-background",
              )}
            >
              {/* Unread indicator */}
              {n.readAt == null && (
                <span
                  aria-label={labels.notifications.readStatus.unread}
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                />
              )}
              {n.readAt != null && <span className="mt-1.5 h-2 w-2 shrink-0" />}

              <div className="min-w-0 flex-1 space-y-0.5">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    n.readAt != null && "text-muted-foreground",
                  )}
                >
                  {n.title}
                </p>
                <p className="text-muted-foreground line-clamp-2 text-xs">{n.body}</p>
                <p className="text-muted-foreground text-[10px]">
                  {new Date(n.createdAt).toLocaleString("ja-JP")}
                </p>
              </div>

              {/* Mark read button (only when unread) */}
              {n.readAt == null && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-xs"
                  onClick={() => void handleMarkRead(n.id)}
                >
                  {labels.notifications.markRead}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => void handleLoadMore()}
          >
            {loadingMore ? `${labels.notifications.loadMore}…` : labels.notifications.loadMore}
          </Button>
        </div>
      )}

      {!isEmpty && (
        <p className="text-muted-foreground text-center text-xs">
          {labels.notifications.showingOf
            .replace("{shown}", String(items.length))
            .replace("{total}", String(total))}
        </p>
      )}
    </div>
  );
}
