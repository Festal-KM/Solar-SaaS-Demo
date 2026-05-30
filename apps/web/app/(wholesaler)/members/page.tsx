import { ComingSoon } from "@/components/coming-soon";
import { labels } from "@/lib/i18n/labels";

export const dynamic = "force-dynamic";

export default function Page() {
  return <ComingSoon title={labels.comingSoon.members} />;
}
