"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { labels } from "@/lib/i18n/labels";

import { AreaModal, type AreaModalMode } from "./area-modal";

import type { AreaTypeValue } from "@solar/contracts";

// エリア設定タブの本体（ハブ + スタンドアロン /masters/areas で共有）。
// イベント/顧客のサブタブ + 一覧 + 新規・編集モーダルを管理する。
// データは Server Component で取得して props で受け取る前提。

interface AreaRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

interface AreasTabContentProps {
  eventAreas: AreaRow[];
  customerAreas: AreaRow[];
  defaultType?: AreaTypeValue;
}

export function AreasTabContent({
  eventAreas,
  customerAreas,
  defaultType = "EVENT",
}: AreasTabContentProps) {
  const c = labels.common;
  const area = labels.areaMaster;

  const [modalMode, setModalMode] = useState<AreaModalMode | null>(null);
  const [activeType, setActiveType] = useState<AreaTypeValue>(defaultType);

  function openCreate() {
    setModalMode({ kind: "create", type: activeType });
  }

  function openEdit(row: AreaRow, type: AreaTypeValue) {
    setModalMode({
      kind: "edit",
      id: row.id,
      type,
      initial: { name: row.name, description: row.description, isActive: row.isActive },
    });
  }

  const tabs: Array<{ key: AreaTypeValue; label: string; rows: AreaRow[] }> = [
    { key: "EVENT", label: "イベントエリア", rows: eventAreas },
    { key: "CUSTOMER", label: "顧客エリア", rows: customerAreas },
  ];

  return (
    <>
      <Tabs
        value={activeType}
        onValueChange={(v) => setActiveType(v as AreaTypeValue)}
        className="space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="grid w-fit grid-cols-2 gap-1">
            {tabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="w-40">
                {t.label} ({t.rows.length})
              </TabsTrigger>
            ))}
          </TabsList>
          <Button size="sm" onClick={openCreate}>
            {area.new}
          </Button>
        </div>

        {tabs.map((t) => (
          <TabsContent key={t.key} value={t.key}>
            {t.rows.length === 0 ? (
              <div className="border-border bg-muted/30 rounded-md border p-6 text-center">
                <p className="text-foreground font-medium">{area.empty}</p>
                <p className="text-muted-foreground mt-2 text-sm">{area.emptyCta}</p>
                <Button className="mt-4" size="sm" onClick={openCreate}>
                  {area.new}
                </Button>
              </div>
            ) : (
              <div className="border-border overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">{area.fields.name}</th>
                      <th className="px-3 py-2 font-medium">説明</th>
                      <th className="px-3 py-2 font-medium">{area.fields.isActive}</th>
                      <th className="px-3 py-2 font-medium">{area.fields.updatedAt}</th>
                      <th className="px-3 py-2 font-medium">
                        <span className="sr-only">{c.edit}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r) => (
                      <tr
                        key={r.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openEdit(r, t.key)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openEdit(r, t.key);
                          }
                        }}
                        className="border-border hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-primary/40 cursor-pointer border-t focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
                      >
                        <td className="px-3 py-2 font-medium">{r.name}</td>
                        <td className="text-muted-foreground px-3 py-2 text-xs">
                          {r.description ?? "—"}
                        </td>
                        <td className="px-3 py-2">{r.isActive ? c.active : c.inactive}</td>
                        <td className="text-muted-foreground px-3 py-2 text-xs">
                          {new Date(r.updatedAt).toLocaleString("ja-JP")}
                        </td>
                        <td className="text-muted-foreground px-3 py-2 text-right text-xs">
                          編集
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {modalMode ? (
        <AreaModal
          mode={modalMode}
          open={modalMode !== null}
          onOpenChange={(o) => {
            if (!o) setModalMode(null);
          }}
        />
      ) : null}
    </>
  );
}
