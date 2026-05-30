import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { getInstaller } from "../data";
import { InstallerForm } from "../installer-form";

import type { InstallerInput } from "@solar/contracts";

// 施工業者マスタ 詳細・編集 (S-052 sub / F-013). `getInstaller` runs through
// the same auth → assertCan(installer.read) → withTenant pipeline as the list,
// so cross-tenant ids resolve to null (RLS) and 404 here. The form itself
// calls `updateInstallerAction` / `disableInstallerAction` which re-check
// `installer.update` — non-admin wholesaler roles can read but not edit.

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InstallerDetailPage({ params }: PageProps) {
  const { id } = await params;
  const row = await getInstaller(id);
  if (!row) {
    notFound();
  }

  const t = labels.installer;
  const bc = labels.breadcrumb.items;

  const initial: InstallerInput & { isActive: boolean } = {
    name: row.name,
    contactName: row.contactName ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    area: row.area ?? undefined,
    isActive: row.isActive,
  };

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.masters, href: "/masters" },
          { label: bc.masterInstallers, href: "/masters/installers" },
          { label: bc.masterInstallerDetail },
        ]}
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button asChild variant="outline" size="sm">
            <Link href="/masters/installers">{labels.common.back}</Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{t.edit}</h1>
        </div>
        <span className="text-muted-foreground text-sm">
          {row.isActive ? labels.common.active : labels.common.inactive}
        </span>
      </div>
      <InstallerForm mode={{ kind: "edit", id: row.id, initial }} />
    </div>
  );
}
