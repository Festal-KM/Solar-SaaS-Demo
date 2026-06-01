import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { getVenueProvider, listStoresByProvider } from "../data";
import { VenueProviderForm } from "../venue-provider-form";

import type { VenueProviderInput } from "@solar/contracts";

// S-020 — 場所提供元マスタ詳細・編集. `getVenueProvider` runs through the same
// auth → assertCan(read) → withTenant pipeline, so cross-tenant ids resolve to
// `null` (RLS) and 404 here.

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VenueProviderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const row = await getVenueProvider(id);
  if (!row) {
    notFound();
  }

  const t = labels.venueProvider;
  const bc = labels.breadcrumb.items;
  const childStores = await listStoresByProvider(row.id);

  // Legacy rows (pre-SP-02) may still have a null `address` at the DB level
  // (Prisma schema keeps it nullable; the new docs/02 §F-011 requirement is
  // enforced application-side via Zod). When that happens, surface an empty
  // string so the form renders the field empty and the user is forced to fill
  // it before saving — `VenueProviderInputSchema` will reject `""`.
  const initial: VenueProviderInput & { isActive: boolean } = {
    name: row.name,
    contactName: row.contactName ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    postalCode: row.postalCode ?? undefined,
    address: row.address ?? "",
    area: row.area ?? undefined,
    contractType: row.contractType ?? undefined,
    fixedFee: row.fixedFee ?? undefined,
    performanceRate: row.performanceRate ?? undefined,
    note: row.note ?? undefined,
    isActive: row.isActive,
  };

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.masters, href: "/masters" },
          { label: bc.masterVenueProviders, href: "/masters/venue-providers" },
          { label: bc.masterVenueProviderDetail },
        ]}
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button asChild variant="outline" size="sm">
            <Link href="/masters/venue-providers">{labels.common.back}</Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{t.edit}</h1>
        </div>
        <span className="text-muted-foreground text-sm">
          {row.isActive ? labels.common.active : labels.common.inactive}
        </span>
      </div>
      <VenueProviderForm mode={{ kind: "edit", id: row.id, initial }} />

      {/* 紐づく店舗（支店）一覧。1 : N の子側を表示。新規追加は店舗マスタの
          新規作成画面で親をこの provider に指定する想定 → 直リンクを置く。 */}
      <section aria-label="店舗（支店）" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">店舗（支店）</h2>
          <Button asChild variant="outline" size="sm">
            <Link href="/masters/stores/new">店舗を追加</Link>
          </Button>
        </div>
        {childStores.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            この場所提供元には店舗（支店）がまだ登録されていません。
          </p>
        ) : (
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">店舗名</th>
                  <th className="px-3 py-2 font-medium">状態</th>
                  <th className="px-3 py-2 font-medium">最終更新</th>
                  <th className="px-3 py-2 font-medium">
                    <span className="sr-only">編集</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {childStores.map((s) => (
                  <tr key={s.id} className="border-border border-t">
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2">
                      {s.isActive ? labels.common.active : labels.common.inactive}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {new Date(s.updatedAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/masters/stores/${s.id}`}
                        className="text-primary text-xs underline-offset-4 hover:underline"
                      >
                        編集
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* TODO(SP-03 HistoryTimeline) — docs/04 §S-020「基本情報 / 連絡先 / 住所 /
          契約条件 / 備考 / 変更履歴」の最後のセクション。`HistoryTimeline`
          コンポーネントを後続スプリントで追加し、`audit_log` テーブルから
          該当 venue_provider の変更履歴を時系列表示する想定。 */}
      <section aria-label={t.sections.history} className="space-y-2">
        <h2 className="text-lg font-medium">{t.sections.history}</h2>
        <p className="text-muted-foreground text-sm">{t.historyPlaceholder}</p>
      </section>
    </div>
  );
}
