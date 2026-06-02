// 製品カタログ > BTカタログ（蓄電池）— 中身は未実装のプレースホルダー。

import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

export const dynamic = "force-dynamic";

export default function BtCatalogPage() {
  const t = labels.productCatalog;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{t.bt.title}</h1>
        <p className="mt-1 text-sm text-mute-light">{t.bt.subtitle}</p>
      </div>
      <Card className="p-12 text-center">
        <p className="font-medium text-ink">{t.placeholderTitle}</p>
        <p className="mt-2 text-sm text-mute-light">{t.placeholderBody}</p>
      </Card>
    </div>
  );
}
