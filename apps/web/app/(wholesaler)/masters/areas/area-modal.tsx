"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { labels } from "@/lib/i18n/labels";

import { createAreaAction, disableAreaAction, updateAreaAction } from "./actions";

import type { AreaTypeValue } from "@solar/contracts";

// エリアマスタ 新規/編集モーダル。詳細ページを廃止し、ハブの一覧画面から直接
// ポップアップで CRUD する。`mode.kind === "edit"` のときは無効化ボタンも
// 表示する。type は固定（呼び出し側がサブタブから渡す）— モーダル内では変更
// しない設計で、誤って種別が変わるのを防ぐ。

export type AreaModalMode =
  | { kind: "create"; type: AreaTypeValue }
  | {
      kind: "edit";
      id: string;
      type: AreaTypeValue;
      initial: { name: string; description: string | null; isActive: boolean };
    };

interface AreaModalProps {
  mode: AreaModalMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AreaModal({ mode, open, onOpenChange }: AreaModalProps) {
  const router = useRouter();
  const c = labels.common;

  const [name, setName] = useState(
    mode.kind === "edit" ? mode.initial.name : "",
  );
  const [description, setDescription] = useState(
    mode.kind === "edit" ? (mode.initial.description ?? "") : "",
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [disabling, startDisabling] = useTransition();

  function onSubmit() {
    if (!name.trim()) {
      setServerError("名称を入力してください");
      return;
    }
    setServerError(null);
    startTransition(async () => {
      try {
        if (mode.kind === "create") {
          await createAreaAction({
            name: name.trim(),
            type: mode.type,
            description: description.trim() || null,
          });
        } else {
          await updateAreaAction({
            id: mode.id,
            patch: {
              name: name.trim(),
              description: description.trim() || null,
            },
          });
        }
        toast.success(c.saved);
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  function onDisable() {
    if (mode.kind !== "edit") return;
    if (!window.confirm("このエリアを無効化しますか？")) return;
    startDisabling(async () => {
      try {
        await disableAreaAction({ id: mode.id });
        toast.success(c.disabled);
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setServerError(message);
      }
    });
  }

  const typeLabel = mode.type === "CUSTOMER" ? "顧客エリア" : "イベントエリア";
  const title = mode.kind === "create" ? `${typeLabel}を新規登録` : `${typeLabel}を編集`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode.kind === "create"
              ? "名称と説明を入力して登録してください。"
              : "名称と説明を編集して保存してください。"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label htmlFor="area-modal-name" className="text-sm font-medium">
              名称 <span className="text-destructive">*</span>
            </label>
            <Input
              id="area-modal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="area-modal-description" className="text-sm font-medium">
              説明
            </label>
            <textarea
              id="area-modal-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm"
              placeholder="運用ルール、対象市区町村など"
            />
          </div>
          {serverError ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {serverError}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {mode.kind === "edit" && mode.initial.isActive ? (
            <Button
              type="button"
              variant="destructive"
              disabled={disabling || pending}
              onClick={onDisable}
            >
              {disabling ? c.disabling : "無効化"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={pending || disabling}
            onClick={() => onOpenChange(false)}
          >
            {c.cancel}
          </Button>
          <Button type="button" disabled={pending || disabling} onClick={onSubmit}>
            {pending ? c.saving : c.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
