import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { getArea } from "../data";
import { AreaForm } from "../area-form";

import type { AreaInput } from "@solar/contracts";

// エリアマスタ 詳細・編集. `getArea` runs through the same auth →
// assertCan(area.read) → withTenant pipeline as the list, so cross-tenant ids
// resolve to null (RLS) and 404 here. The form calls updateAreaAction /
// disableAreaAction which re-check `area.update`.

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AreaDetailPage({ params }: PageProps) {
  const { id } = await params;
  const row = await getArea(id);
  if (!row) {
    notFound();
  }

  const t = labels.areaMaster;
  const c = labels.common;

  const initial: AreaInput & { isActive: boolean } = {
    name: row.name,
    isActive: row.isActive,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button asChild variant="outline" size="sm">
            <Link href="/masters/areas">{c.back}</Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{t.edit}</h1>
        </div>
        <span className="text-muted-foreground text-sm">
          {row.isActive ? c.active : c.inactive}
        </span>
      </div>
      <AreaForm mode={{ kind: "edit", id: row.id, initial }} />
    </div>
  );
}
