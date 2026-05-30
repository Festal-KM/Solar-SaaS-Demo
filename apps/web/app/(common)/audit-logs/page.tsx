// 監査ログ — 準備中（プレースホルダ）。(common) グループ配下に置くことで、
// 役割別レイアウト（卸業者 / saas 運営者）の適切なサイドバーで表示される。

import { ComingSoon } from "@/components/coming-soon";
import { labels } from "@/lib/i18n/labels";

export const dynamic = "force-dynamic";

export default function AuditLogsPage() {
  return <ComingSoon title={labels.comingSoon.auditLogs} />;
}
