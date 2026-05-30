// 申請一覧 — プレースホルダ。ページ内要素は後続で定義する。

import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

export const dynamic = "force-dynamic";

export default function ApplicationsPage() {
  const t = labels.applicationList;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{t.title}</h1>
        <p className="text-body-light text-sm mt-1">{t.subtitle}</p>
      </div>
      <Card className="px-6 py-12 text-center text-mute-light text-sm">{t.placeholder}</Card>
    </div>
  );
}
