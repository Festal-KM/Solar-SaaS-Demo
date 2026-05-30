import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { listAreas } from "./data";

// エリアマスタ 一覧. installers と同じ plain table + GET-form フィルタ。
// イベント候補登録フォームのエリア選択肢をここで管理する。

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ name?: string }>;
}

export default async function AreasListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filterName = params.name?.trim() ?? "";
  const rows = await listAreas({
    ...(filterName ? { name: filterName } : {}),
  });

  const t = labels.areaMaster;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground text-sm">{t.listTitle}</p>
        </div>
        <Button asChild>
          <Link href="/masters/areas/new">{t.new}</Link>
        </Button>
      </div>

      <form method="get" className="flex max-w-xl items-center gap-2">
        <Input
          type="search"
          name="name"
          defaultValue={filterName}
          placeholder={t.searchByName}
          aria-label={t.searchByName}
        />
        <Button type="submit" variant="outline">
          {c.search}
        </Button>
      </form>

      {rows.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border p-8 text-center">
          <p className="text-foreground font-medium">{t.empty}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t.emptyCta}</p>
          <Button asChild className="mt-4">
            <Link href="/masters/areas/new">{t.new}</Link>
          </Button>
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t.fields.name}</th>
                <th className="px-3 py-2 font-medium">{t.fields.isActive}</th>
                <th className="px-3 py-2 font-medium">{t.fields.updatedAt}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-border border-t">
                  <td className="px-3 py-2">
                    <Link
                      href={`/masters/areas/${r.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.isActive ? c.active : c.inactive}</td>
                  <td className="text-muted-foreground px-3 py-2 text-xs">
                    {new Date(r.updatedAt).toLocaleString("ja-JP")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
