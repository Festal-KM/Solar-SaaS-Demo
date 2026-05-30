// S-080 — 通知設定画面 (T-07-06 / F-052 / F-053 / docs/04 §1.7).
//
// チャネル別 (IN_APP / EMAIL) × type 別のチェックボックスマトリクス。
// LINE は FEATURE_LINE_NOTIFICATIONS env var が falsy の間は disabled 表示。
// 設定変更は「保存」ボタン押下時に一括 upsert する。

import { Suspense } from "react";

import { labels } from "@/lib/i18n/labels";

import { getNotificationPreferencesAction } from "./actions";
import { NotificationSettingsForm } from "./notification-settings-form";

export default async function NotificationSettingsPage() {
  const savedPrefs = await getNotificationPreferencesAction({});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {labels.notificationSettings.pageTitle}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {labels.notificationSettings.pageSubtitle}
        </p>
      </div>
      <Suspense fallback={null}>
        <NotificationSettingsForm initialPrefs={savedPrefs} />
      </Suspense>
    </div>
  );
}
