"use client";

// T-03-04 / F-019 — 二次店共有設定 UI (S-024 の visibility セクション本体).
//
// アクティブな二次店関係一覧をチェックボックス付きで表示し、選択された
// relationshipIds に対して `updateVisibilityAction(isVisible)` を発火する。
// 公開中の行には「公開中」バッジを表示。状態機械は Server Action 側で再検証
// されるため、ここでは見栄えと UX のみ担当。
//
// shadcn の Checkbox / Badge は本プロジェクトにまだ追加されていないため、
// 既存導入済みコンポーネント (Button) + 素の HTML <input type="checkbox"> +
// Tailwind 装飾の span で代替する。Button の `default/outline/ghost` バリアント
// だけは使う。

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";
import { cn } from "@/lib/utils";

import { updateVisibilityAction } from "./actions";

import type { EventCandidateVisibilityRow } from "./data";
import type { EventCandidateStatus } from "@solar/contracts";

interface VisibilityControlProps {
  eventCandidateId: string;
  candidateStatus: EventCandidateStatus;
  rows: EventCandidateVisibilityRow[];
}

type PendingMode = "publish" | "unpublish" | null;

const CHECKBOX_CLASS =
  "border-input text-primary focus-visible:ring-ring h-4 w-4 rounded border focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50";

const BADGE_BASE = "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium";

export function VisibilityControl({
  eventCandidateId,
  candidateStatus,
  rows,
}: VisibilityControlProps) {
  const router = useRouter();
  const t = labels.eventCandidate.visibility;
  const c = labels.common;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingMode, setPendingMode] = useState<PendingMode>(null);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const draftDisabled = candidateStatus === "DRAFT";
  const totalSelectable = rows.length;
  const allSelected = useMemo(
    () => totalSelectable > 0 && selected.size === totalSelectable,
    [selected, totalSelectable],
  );

  if (draftDisabled) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
        {t.draftDisabledNotice}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
        {t.noRelationships}
      </p>
    );
  }

  function toggle(relationshipId: string, next: boolean) {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(relationshipId);
      else copy.delete(relationshipId);
      return copy;
    });
  }

  function toggleAll(next: boolean) {
    if (next) setSelected(new Set(rows.map((r) => r.relationshipId)));
    else setSelected(new Set());
  }

  function run(mode: PendingMode, isVisible: boolean) {
    setServerError(null);
    if (selected.size === 0) {
      setServerError(t.selectAtLeastOne);
      return;
    }
    setPendingMode(mode);
    startTransition(async () => {
      try {
        await updateVisibilityAction({
          eventCandidateId,
          relationshipIds: Array.from(selected),
          isVisible,
        });
        toast.success(isVisible ? t.publishedToast : t.unpublishedToast);
        setSelected(new Set());
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      } finally {
        setPendingMode(null);
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t.description}</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th scope="col" className="w-12 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={t.bulkSelectAll}
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={pending}
                  className={CHECKBOX_CLASS}
                />
              </th>
              <th scope="col" className="px-3 py-2">
                {t.tableHeaderDealer}
              </th>
              <th scope="col" className="px-3 py-2">
                {t.tableHeaderStatus}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isChecked = selected.has(row.relationshipId);
              return (
                <tr key={row.relationshipId} className="border-t">
                  <td className="px-3 py-2 align-middle">
                    <input
                      type="checkbox"
                      aria-label={row.dealerName}
                      checked={isChecked}
                      onChange={(e) => toggle(row.relationshipId, e.target.checked)}
                      disabled={pending}
                      className={CHECKBOX_CLASS}
                    />
                  </td>
                  <td className="px-3 py-2 align-middle">{row.dealerName}</td>
                  <td className="px-3 py-2 align-middle">
                    {row.state === "PUBLISHED" ? (
                      <span
                        className={cn(BADGE_BASE, "bg-primary text-primary-foreground")}
                        aria-label={t.published}
                      >
                        {t.published}
                      </span>
                    ) : row.state === "REVOKED" ? (
                      <span
                        className={cn(BADGE_BASE, "border-border text-muted-foreground border")}
                        aria-label={t.revoked}
                      >
                        {t.revoked}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t.notPublished}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={pending || selected.size === 0}
          onClick={() => run("publish", true)}
        >
          {pending && pendingMode === "publish" ? t.publishing : t.publishSelected}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || selected.size === 0}
          onClick={() => run("unpublish", false)}
        >
          {pending && pendingMode === "unpublish" ? t.unpublishing : t.unpublishSelected}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending || selected.size === 0}
          onClick={() => setSelected(new Set())}
        >
          {t.bulkClear}
        </Button>
      </div>
      {serverError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {serverError}
        </p>
      ) : null}
    </div>
  );
}
