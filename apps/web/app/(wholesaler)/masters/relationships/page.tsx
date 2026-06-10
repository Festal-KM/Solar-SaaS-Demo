import Link from "next/link";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { labels } from "@/lib/i18n/labels";

import { listRelationships } from "./data";
import { RelationshipRow } from "./relationship-row";

// /masters/relationships — 二次店一覧マスタ（マスタ管理ハブから遷移）。
// 既存の Relationship 行（招待コード経由でサインアップ済みの二次店）を一覧
// 表示し、ステータス / 既定スコープ / 備考をインライン編集する。新規登録は
// 招待コードフローの責務（後続スプリント）なのでここには出さない。

export const dynamic = "force-dynamic";

export default async function RelationshipsMasterPage() {
  const rows = await listRelationships();
  const t = labels.dealerRelationships;
  const bc = labels.breadcrumb.items;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: bc.masters, href: "/masters" },
          { label: t.title },
        ]}
      />

      <div>
        <Link
          href="/masters"
          className="text-pewter hover:text-carbon-dark mb-4 flex items-center gap-1 text-sm"
        >
          ← {c.back}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.subtitle}</p>
      </div>

      {rows.length === 0 ? (
        <div className="border-cloud-gray rounded-lg border p-12 text-center">
          <p className="text-carbon-dark font-medium">{t.empty}</p>
          <p className="text-pewter mt-2 text-sm">{t.emptyCta}</p>
        </div>
      ) : (
        <div className="border-cloud-gray overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t.fields.dealerName}</th>
                <th className="px-3 py-2 font-medium">{t.fields.franchiseNo}</th>
                <th className="px-3 py-2 font-medium">{t.fields.status}</th>
                <th className="px-3 py-2 font-medium">{t.fields.defaultScope}</th>
                <th className="px-3 py-2 font-medium">{t.fields.note}</th>
                <th className="px-3 py-2 font-medium">{t.fields.updatedAt}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RelationshipRow key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
