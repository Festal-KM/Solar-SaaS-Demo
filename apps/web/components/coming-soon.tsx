import { Card } from "@/components/ui/card";
import { labels } from "@/lib/i18n/labels";

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      </div>
      <Card className="px-6 py-16 text-center text-mute-light text-sm">
        {labels.common.comingSoon}
      </Card>
    </div>
  );
}
