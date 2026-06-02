import Link from "next/link";

import { labels } from "@/lib/i18n/labels";

import { AreasTabContent } from "./areas-tab-content";
import { listAreas } from "./data";

import type { AreaTypeValue } from "@solar/contracts";

// /masters/areas — スタンドアロンのエリア設定ページ。ハブ内で表示する
// AreasTabContent をそのまま流用してモーダル CRUD を提供する。

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ type?: string }>;
}

function coerceType(value: string | undefined): AreaTypeValue {
  return value === "CUSTOMER" ? "CUSTOMER" : "EVENT";
}

export default async function AreasListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const defaultType = coerceType(params.type);
  const [eventAreas, customerAreas] = await Promise.all([
    listAreas({ type: "EVENT" }),
    listAreas({ type: "CUSTOMER" }),
  ]);

  const t = labels.areaMaster;
  const c = labels.common;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/masters"
          className="text-pewter hover:text-carbon-dark mb-2 inline-flex items-center gap-1 text-sm"
        >
          ← {c.back}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">
          イベント開催エリア / 顧客エリアをタブで切り替えて管理します
        </p>
      </div>

      <AreasTabContent
        eventAreas={eventAreas.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          isActive: a.isActive,
          updatedAt: a.updatedAt,
        }))}
        customerAreas={customerAreas.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          isActive: a.isActive,
          updatedAt: a.updatedAt,
        }))}
        defaultType={defaultType}
      />
    </div>
  );
}
