import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { labels } from "@/lib/i18n/labels";

import { getMastersHubSummary } from "./data";

// /masters — マスタ管理ハブ。3 タブ構成（エリア設定 → 場所提供元 → 二次店一覧）。
// 場所提供元は 1 : N で店舗（VenueProvider.stores）を持つ親子関係。タブ自身は
// 左寄せ + 各タブ幅を grid で統一。

export const dynamic = "force-dynamic";

export default async function MastersHubPage() {
  const summary = await getMastersHubSummary();
  const t = labels.masters;
  const c = labels.common;
  const dealerLabels = labels.dealerRelationships;
  const area = labels.areaMaster;
  const venueProvider = labels.venueProvider;
  const store = labels.storeMaster;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.subtitle}</p>
      </div>

      <Tabs defaultValue="areas" className="space-y-4">
        {/* TabsList は左寄せ + 各タブ等幅。w-fit でリスト自身は内容幅に縮める */}
        <TabsList className="grid w-fit grid-cols-3 gap-1">
          <TabsTrigger value="areas" className="w-40">
            エリア設定
          </TabsTrigger>
          <TabsTrigger value="venueProviders" className="w-40">
            場所提供元
          </TabsTrigger>
          <TabsTrigger value="relationships" className="w-40">
            二次店一覧
          </TabsTrigger>
        </TabsList>

        {/* タブ 1: エリア設定 */}
        <TabsContent value="areas">
          <section
            aria-labelledby="tab-areas-heading"
            className="border-border bg-card space-y-4 rounded-md border p-6"
          >
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 id="tab-areas-heading" className="text-lg font-semibold">
                  {t.tabs.areas.label}
                </h2>
                <p className="text-muted-foreground text-sm">{t.tabs.areas.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/masters/areas">{t.embedded.openFullPage}</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/masters/areas/new">{area.new}</Link>
                </Button>
              </div>
            </header>

            <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:max-w-xs">
              <dt>{t.summary.count}</dt>
              <dd className="text-foreground text-right tabular-nums">
                {summary.areas.totalActiveCount.toLocaleString("ja-JP")}
                <span className="text-muted-foreground ml-1">{t.summary.activeOnly}</span>
              </dd>
            </dl>

            {summary.areas.preview.length === 0 ? (
              <div className="border-border bg-muted/30 rounded-md border p-6 text-center">
                <p className="text-foreground font-medium">{area.empty}</p>
                <p className="text-muted-foreground mt-2 text-sm">{area.emptyCta}</p>
              </div>
            ) : (
              <div className="border-border overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">{area.fields.name}</th>
                      <th className="px-3 py-2 font-medium">{area.fields.updatedAt}</th>
                      <th className="px-3 py-2 font-medium">
                        <span className="sr-only">{c.edit}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.areas.preview.map((r) => (
                      <tr key={r.id} className="border-border border-t">
                        <td className="px-3 py-2 font-medium">{r.name}</td>
                        <td className="text-muted-foreground px-3 py-2 text-xs">
                          {new Date(r.updatedAt).toLocaleString("ja-JP")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/masters/areas/${r.id}`}
                            className="text-primary text-xs underline-offset-4 hover:underline"
                          >
                            {t.embedded.goToDetail}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </TabsContent>

        {/* タブ 2: 場所提供元（チェーン）+ 子の店舗（支店）。1 : N の親子関係を
            表で表現：1 行目に親（場所提供元）、その下に子（店舗）を字下げ表示。 */}
        <TabsContent value="venueProviders">
          <section
            aria-labelledby="tab-venue-providers-heading"
            className="border-border bg-card space-y-4 rounded-md border p-6"
          >
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 id="tab-venue-providers-heading" className="text-lg font-semibold">
                  {venueProvider.title} ({summary.venueProviders.totalActiveCount.toLocaleString("ja-JP")} 件 / 店舗 {summary.venueProviders.totalStoreCount.toLocaleString("ja-JP")} 件)
                </h2>
                <p className="text-muted-foreground text-sm">
                  チェーン（場所提供元）とその支店（店舗）の親子関係を管理します
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/masters/venue-providers">{t.embedded.openFullPage}</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/masters/venue-providers/new">{venueProvider.new}</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/masters/stores/new">{store.new}</Link>
                </Button>
              </div>
            </header>

            {summary.venueProviders.preview.length === 0 ? (
              <div className="border-border bg-muted/30 rounded-md border p-6 text-center">
                <p className="text-foreground font-medium">{venueProvider.empty}</p>
              </div>
            ) : (
              <div className="border-border overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">{venueProvider.fields.name}</th>
                      <th className="px-3 py-2 font-medium">{venueProvider.fields.area}</th>
                      <th className="px-3 py-2 font-medium">店舗（支店）</th>
                      <th className="px-3 py-2 font-medium">
                        <span className="sr-only">{c.edit}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.venueProviders.preview.map((r) => (
                      <tr key={r.id} className="border-border border-t align-top">
                        <td className="px-3 py-2 font-medium">{r.name}</td>
                        <td className="text-muted-foreground px-3 py-2">{r.area ?? "—"}</td>
                        <td className="px-3 py-2">
                          {r.stores.length === 0 ? (
                            <span className="text-muted-foreground text-xs">支店なし</span>
                          ) : (
                            <ul className="text-muted-foreground space-y-0.5 text-xs">
                              {r.stores.map((s) => (
                                <li key={s.id}>
                                  <span className="text-foreground">└</span> {s.name}
                                </li>
                              ))}
                              {r.storeCount > r.stores.length ? (
                                <li className="italic">
                                  …他 {(r.storeCount - r.stores.length).toLocaleString("ja-JP")} 店舗
                                </li>
                              ) : null}
                            </ul>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/masters/venue-providers/${r.id}`}
                            className="text-primary text-xs underline-offset-4 hover:underline"
                          >
                            {t.embedded.goToDetail}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </TabsContent>

        {/* タブ 3: 二次店一覧 */}
        <TabsContent value="relationships">
          <section
            aria-labelledby="tab-relationships-heading"
            className="border-border bg-card space-y-4 rounded-md border p-6"
          >
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 id="tab-relationships-heading" className="text-lg font-semibold">
                  {dealerLabels.title}
                </h2>
                <p className="text-muted-foreground text-sm">{dealerLabels.subtitle}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/masters/relationships">{t.embedded.openFullPage}</Link>
                </Button>
              </div>
            </header>

            <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:max-w-xs">
              <dt>{t.summary.count}</dt>
              <dd className="text-foreground text-right tabular-nums">
                {summary.dealerRelationships.activeCount.toLocaleString("ja-JP")}
                <span className="text-muted-foreground ml-1">{t.summary.activeOnly}</span>
              </dd>
            </dl>

            {summary.dealerRelationships.preview.length === 0 ? (
              <div className="border-border bg-muted/30 rounded-md border p-6 text-center">
                <p className="text-foreground font-medium">{dealerLabels.empty}</p>
                <p className="text-muted-foreground mt-2 text-sm">{dealerLabels.emptyCta}</p>
              </div>
            ) : (
              <div className="border-border overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">{dealerLabels.fields.dealerName}</th>
                      <th className="px-3 py-2 font-medium">{dealerLabels.fields.status}</th>
                      <th className="px-3 py-2 font-medium">
                        {dealerLabels.fields.defaultScope}
                      </th>
                      <th className="px-3 py-2 font-medium">{dealerLabels.fields.updatedAt}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.dealerRelationships.preview.map((r) => (
                      <tr key={r.id} className="border-border border-t">
                        <td className="px-3 py-2 font-medium">{r.dealerName}</td>
                        <td className="px-3 py-2">{dealerLabels.statuses[r.status]}</td>
                        <td className="px-3 py-2">{dealerLabels.scopes[r.defaultScope]}</td>
                        <td className="text-muted-foreground px-3 py-2 text-xs">
                          {new Date(r.updatedAt).toLocaleString("ja-JP")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
