import { labels } from "@/lib/i18n/labels";

import { getWholesalerSettings } from "./data";
import { WholesalerSettingsForm } from "./wholesaler-settings-form";

// 卸業者設定ページ (S-052 内のサブセクション / F-015 §F-016).
// SP-02 後半 (T-02-10) でマスタハブの Tabs に統合予定だが、本タスクでは独立
// `/masters/wholesaler-settings` で OK。

export const dynamic = "force-dynamic";

export default async function WholesalerSettingsPage() {
  const settings = await getWholesalerSettings();
  const t = labels.wholesalerSettings;

  if (!settings) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{labels.common.notFound}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.subtitle}</p>
      </div>
      <div className="max-w-2xl">
        <WholesalerSettingsForm
          initial={{
            cancelDeadlineDays: settings.cancelDeadlineDays,
            fiscalYearStartMonth: settings.fiscalYearStartMonth,
            piiMaskingMode: settings.piiMaskingMode,
          }}
        />
      </div>
    </div>
  );
}
