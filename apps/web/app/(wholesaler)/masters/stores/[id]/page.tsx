import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { getStore, listVenueProviderOptions } from "../data";
import { StoreForm } from "../store-form";

import type { StoreInput } from "@solar/contracts";

// 店舗マスタ 詳細・編集. `getStore` runs through the same auth →
// assertCan(store.read) → withTenant pipeline as the list, so cross-tenant ids
// resolve to null (RLS) and 404 here. The form calls updateStoreAction /
// disableStoreAction which re-check `store.update`.

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function StoreDetailPage({ params }: PageProps) {
  const { id } = await params;
  const row = await getStore(id);
  if (!row) {
    notFound();
  }

  const t = labels.storeMaster;
  const c = labels.common;

  const initial: StoreInput & { isActive: boolean } = {
    name: row.name,
    venueProviderId: row.venueProviderId,
    isActive: row.isActive,
  };
  const venueProviders = await listVenueProviderOptions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button asChild variant="outline" size="sm">
            <Link href="/masters/stores">{c.back}</Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{t.edit}</h1>
        </div>
        <span className="text-muted-foreground text-sm">
          {row.isActive ? c.active : c.inactive}
        </span>
      </div>
      <StoreForm
        mode={{ kind: "edit", id: row.id, initial }}
        venueProviders={venueProviders}
      />
    </div>
  );
}
