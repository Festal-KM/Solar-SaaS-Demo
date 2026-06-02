// 顧客管理配下「マエカク一覧」— 中身は未実装のプレースホルダー。
// ナビ階層上は 顧客管理 > マエカク一覧 として表示される。

import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

export const dynamic = "force-dynamic";

export default function MaekakuListPage() {
  const t = labels.customer.maekaku;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-sm text-mute-light">{t.subtitle}</p>
      </div>

      <Card className="p-12 text-center">
        <p className="font-medium text-ink">{t.placeholderTitle}</p>
        <p className="mt-2 text-sm text-mute-light">{t.placeholderBody}</p>
      </Card>
    </div>
  );
}
