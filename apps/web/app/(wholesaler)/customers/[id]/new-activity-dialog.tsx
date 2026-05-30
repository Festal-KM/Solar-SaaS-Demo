"use client";

// 顧客詳細「新規記録」ダイアログ (F-031 / docs/04 §1.3).
// 商談履歴 1 件 + 発生タスク（0..n）+ 関連ファイル（R2 直アップロード）を作成する。
// サーバ側ロジックは ./activity-actions（"use server"）に集約。data.ts（server-only）の
// 実行時値は import しない（型のみ）。

import { Plus, Trash2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { createCustomerActivity, presignCustomerFileUpload } from "./activity-actions";
import type { HistoryCategory } from "./data";

interface UserChoice {
  id: string;
  name: string;
}

interface NewActivityDialogProps {
  customerId: string;
  users: UserChoice[];
}

interface TaskRow {
  key: string;
  content: string;
  dueDate: string;
  assigneeUserId: string;
}

interface UploadedFile {
  fileKey: string;
  fileName: string;
  contentType: string | null;
  size: number | null;
}

const CATEGORY_CODES: HistoryCategory[] = [
  "event",
  "phone",
  "appointment",
  "email",
  "visit",
  "other",
];

// timezone-safe な「今日」（toISOString は UTC で日付がずれるため使わない）。
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let rowSeq = 0;
function newTaskRow(): TaskRow {
  rowSeq += 1;
  return { key: `task-${rowSeq}`, content: "", dueDate: "", assigneeUserId: "" };
}

export function NewActivityDialog({ customerId, users }: NewActivityDialogProps) {
  const d = labels.customer.detail;
  const na = d.newActivity;
  const kinds = d.history.kinds;
  const c = labels.common;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [occurredAt, setOccurredAt] = useState(todayLocal());
  const [category, setCategory] = useState<HistoryCategory>("event");
  const [detail, setDetail] = useState("");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);

  function resetForm() {
    setOccurredAt(todayLocal());
    setCategory("event");
    setDetail("");
    setTasks([]);
    setFiles([]);
    setUploadingCount(0);
  }

  function onOpenChange(next: boolean) {
    if (next) resetForm();
    setOpen(next);
  }

  function updateTask(key: string, patch: Partial<TaskRow>) {
    setTasks((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  function removeTask(key: string) {
    setTasks((prev) => prev.filter((t) => t.key !== key));
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const picked = Array.from(fileList);
    for (const file of picked) {
      setUploadingCount((n) => n + 1);
      try {
        const { putUrl, headers, fileKey } = await presignCustomerFileUpload({
          customerId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        });
        const res = await fetch(putUrl, { method: "PUT", headers, body: file });
        if (!res.ok) {
          throw new Error(`アップロードに失敗しました（${res.status}）`);
        }
        setFiles((prev) => [
          ...prev,
          {
            fileKey,
            fileName: file.name,
            contentType: file.type || null,
            size: file.size,
          },
        ]);
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      } finally {
        setUploadingCount((n) => Math.max(0, n - 1));
      }
    }
  }

  function removeFile(fileKey: string) {
    setFiles((prev) => prev.filter((f) => f.fileKey !== fileKey));
  }

  function handleSave() {
    if (!detail.trim()) {
      toast.error(na.detailPlaceholder);
      return;
    }
    const payloadTasks = tasks
      .filter((t) => t.content.trim().length > 0)
      .map((t) => ({
        content: t.content.trim(),
        dueDate: t.dueDate ? t.dueDate : null,
        assigneeUserId: t.assigneeUserId ? t.assigneeUserId : null,
      }));

    startTransition(async () => {
      try {
        await createCustomerActivity({
          customerId,
          occurredAt,
          category,
          detail: detail.trim(),
          tasks: payloadTasks,
          files: files.map((f) => ({
            fileKey: f.fileKey,
            fileName: f.fileName,
            contentType: f.contentType,
            size: f.size,
          })),
        });
        toast.success(c.saved);
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  const busy = isPending || uploadingCount > 0;
  const inputClass =
    "h-9 w-full rounded-sm border border-hairline-light bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus />
          {d.history.newRecord}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{na.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="activity-date">{na.date}</Label>
              <Input
                id="activity-date"
                type="date"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="activity-category">{na.category}</Label>
              <select
                id="activity-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as HistoryCategory)}
                className={inputClass}
              >
                {CATEGORY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {kinds[code]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="activity-detail">{na.detail}</Label>
            <textarea
              id="activity-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={4}
              placeholder={na.detailPlaceholder}
              className="w-full resize-none rounded-sm border border-hairline-light bg-white px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* 発生タスク */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{na.tasks}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setTasks((prev) => [...prev, newTaskRow()])}
              >
                <Plus className="size-3.5" />
                {na.addTask}
              </Button>
            </div>
            {tasks.length > 0 ? (
              <div className="space-y-2">
                {tasks.map((t) => (
                  <div key={t.key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={t.content}
                      onChange={(e) => updateTask(t.key, { content: e.target.value })}
                      placeholder={na.taskContent}
                      className={`${inputClass} sm:min-w-0 sm:flex-1`}
                    />
                    <input
                      type="date"
                      value={t.dueDate}
                      onChange={(e) => updateTask(t.key, { dueDate: e.target.value })}
                      aria-label={na.taskDue}
                      className={`${inputClass} sm:w-36 sm:shrink-0`}
                    />
                    <select
                      value={t.assigneeUserId}
                      onChange={(e) => updateTask(t.key, { assigneeUserId: e.target.value })}
                      aria-label={na.taskAssignee}
                      className={`${inputClass} sm:w-32 sm:shrink-0`}
                    >
                      <option value="">{na.taskAssignee}</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0 text-mute-light hover:text-ink"
                      aria-label={c.delete}
                      onClick={() => removeTask(t.key)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* 関連ファイル */}
          <div className="space-y-2">
            <Label htmlFor="activity-files">{na.files}</Label>
            <input
              id="activity-files"
              type="file"
              multiple
              onChange={(e) => {
                void handleFilesSelected(e.target.files);
                e.target.value = "";
              }}
              className="block w-full text-sm text-body-light file:mr-3 file:rounded-sm file:border file:border-hairline-light file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-slate-50"
            />
            {uploadingCount > 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-mute-light">
                <Upload className="size-3.5 animate-pulse" />
                {na.uploading}
              </p>
            ) : null}
            {files.length > 0 ? (
              <ul className="divide-y divide-hairline-light rounded-sm border border-hairline-light">
                {files.map((f) => (
                  <li key={f.fileKey} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.fileName}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-mute-light hover:text-ink"
                      aria-label={c.delete}
                      onClick={() => removeFile(f.fileKey)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            {na.cancel}
          </Button>
          <Button type="button" onClick={handleSave} disabled={busy}>
            {isPending ? c.saving : na.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
