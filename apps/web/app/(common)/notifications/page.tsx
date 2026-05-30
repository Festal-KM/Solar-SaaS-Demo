// S-079 — 通知インボックス (T-07-04 / F-052 / docs/04 §1.7).
//
// Server component wrapper: session guard happens at the layout level.
// The actual interactive inbox (polling, read/unread toggle, mark-read) lives
// in the NotificationInbox client component below.

import { Suspense } from "react";

import { labels } from "@/lib/i18n/labels";
import { NotificationInbox } from "./notification-inbox";

export default function NotificationsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{labels.notifications.pageTitle}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{labels.notifications.pageSubtitle}</p>
      </div>
      <Suspense fallback={null}>
        <NotificationInbox />
      </Suspense>
    </div>
  );
}
