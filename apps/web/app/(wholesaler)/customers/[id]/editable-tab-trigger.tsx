"use client";

// 施工/契約/ローン審査サブタブのタブ名を右クリック改名する共有トリガー。TabsTrigger を
// ラップし、右クリック（onContextMenu）でカーソル位置に TIP 風の小メニュー →「タブ名を
// 編集する」→ 軽量ポップオーバー（入力＋保存/キャンセル）を表示する。Popover/ContextMenu
// プリミティブが無いため position:fixed の自作ポップオーバー（外側クリック/Esc で閉じる）。
// a11y: キーボード導線として Shift+F10 / ContextMenu キーでメニューを開けるほか、フォーカス
// 時に現れる鉛筆アフォーダンスからも直接ポップオーバーを開ける。保存で永続 → toast → refresh。

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsTrigger } from "@/components/ui/tabs";
import { labels } from "@/lib/i18n/labels";

import { renameProjectTabAction } from "../actions";

export type TabRenameEntity = "construction" | "contract" | "loanReview" | "application";

const MENU_WIDTH = 200;
const EDITOR_WIDTH = 264;

function clampX(x: number, width: number): number {
  if (typeof window === "undefined") return x;
  return Math.max(8, Math.min(x, window.innerWidth - width - 8));
}

export function EditableTabTrigger({
  value,
  label,
  customerId,
  entity,
  id,
  rawLabel,
}: {
  value: string;
  label: string;
  customerId: string;
  entity: TabRenameEntity;
  id: string;
  // 保存済みラベル（プリフィル用）。null は既定表記（施工#N 等）を意味し入力欄は空。
  rawLabel: string | null;
}) {
  const tr = labels.customer.detail.tabRename;
  const c = labels.common;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editor, setEditor] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState(rawLabel ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuItemRef = useRef<HTMLButtonElement | null>(null);

  function openMenuAt(x: number, y: number) {
    setEditor(null);
    setMenu({ x: clampX(x, MENU_WIDTH), y });
  }
  function openEditorAt(x: number, y: number) {
    setMenu(null);
    setText(rawLabel ?? "");
    setEditor({ x: clampX(x, EDITOR_WIDTH), y });
  }

  useEffect(() => {
    if (editor && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editor]);

  useEffect(() => {
    if (menu && menuItemRef.current) menuItemRef.current.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu && !editor) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenu(null);
        setEditor(null);
      }
    }
    function onDown(e: MouseEvent) {
      if ((e.target as HTMLElement).closest("[data-tab-popover]")) return;
      setMenu(null);
      setEditor(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [menu, editor]);

  function onSave() {
    start(async () => {
      try {
        await renameProjectTabAction({ customerId, entity, id, label: text });
        toast.success(c.saved);
        setEditor(null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <span className="group inline-flex items-center gap-0.5">
      <TabsTrigger
        value={value}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenuAt(e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            openMenuAt(r.left + r.width / 2, r.bottom);
          }
        }}
      >
        {label}
      </TabsTrigger>
      <button
        type="button"
        aria-label={tr.editTabName}
        title={tr.editTabName}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openEditorAt(r.left, r.bottom + 4);
        }}
        className="text-mute-light hover:text-ink focus-visible:ring-primary/40 rounded-sm p-0.5 opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 group-hover:opacity-100"
      >
        <Pencil className="size-3" />
      </button>

      {menu ? (
        <div
          data-tab-popover
          role="menu"
          aria-label={tr.menuAria}
          className="border-hairline-light fixed z-50 min-w-[180px] rounded-md border bg-white p-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            ref={menuItemRef}
            type="button"
            role="menuitem"
            onClick={() => openEditorAt(menu.x, menu.y)}
            className="text-ink hover:bg-surface-soft focus-visible:bg-surface-soft flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm focus-visible:outline-none"
          >
            <Pencil className="text-mute-light size-3.5" />
            {tr.editTabName}
          </button>
        </div>
      ) : null}

      {editor ? (
        <div
          data-tab-popover
          className="border-hairline-light fixed z-50 w-64 rounded-md border bg-white p-3 shadow-lg"
          style={{ left: editor.x, top: editor.y }}
        >
          <Input
            ref={inputRef}
            value={text}
            maxLength={40}
            placeholder={tr.placeholder}
            aria-label={tr.inputAria}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSave();
              }
            }}
            className="h-9"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditor(null)}
              disabled={pending}
            >
              {c.cancel}
            </Button>
            <Button type="button" size="sm" onClick={onSave} disabled={pending}>
              {pending ? c.saving : c.save}
            </Button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
