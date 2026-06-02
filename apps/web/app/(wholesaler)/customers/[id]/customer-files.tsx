"use client";

// 関連ファイルタブ — ファイルピッカーで R2 へ直接アップロードし、CustomerFile を記録。
// 既存ファイルはファイル名クリックで pre-signed GET URL を取得し別タブで開く
// (F-031 / docs/04 §1.3). data.ts（server-only）の実行時値は import しない（型のみ）。

import { FileSpreadsheet, FileText, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { labels } from "@/lib/i18n/labels";

import {
  createCustomerFile,
  getCustomerFileDownloadUrl,
  presignCustomerFileUpload,
} from "./activity-actions";

import type { RelatedFile } from "./data";

interface CustomerFilesProps {
  customerId: string;
  files: RelatedFile[];
}

export function CustomerFiles({ customerId, files }: CustomerFilesProps) {
  const d = labels.customer.detail;
  const c = labels.common;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [uploadingCount, setUploadingCount] = useState(0);

  function handleOpen(fileId: string) {
    startTransition(async () => {
      try {
        const { getUrl } = await getCustomerFileDownloadUrl(fileId);
        window.open(getUrl, "_blank", "noopener,noreferrer");
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const picked = Array.from(fileList);
    let recorded = false;
    for (const file of picked) {
      setUploadingCount((n) => n + 1);
      try {
        const { putUrl, headers, fileKey } = await presignCustomerFileUpload({
          customerId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        });
        const res = await fetch(putUrl, { method: "PUT", headers, body: file });
        if (!res.ok) throw new Error(`アップロードに失敗しました（${res.status}）`);
        await createCustomerFile({
          customerId,
          fileKey,
          fileName: file.name,
          contentType: file.type || null,
          size: file.size,
        });
        recorded = true;
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      } finally {
        setUploadingCount((n) => Math.max(0, n - 1));
      }
    }
    if (recorded) {
      toast.success(c.saved);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {/* ファイルピッカー */}
      <div className="space-y-2">
        <input
          id="customer-file-input"
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
            {d.newActivity.uploading}
          </p>
        ) : null}
      </div>

      {/* 一覧 */}
      {files.length === 0 ? (
        <p className="text-sm text-mute-light">{d.files.empty}</p>
      ) : (
        <ul className="divide-y divide-hairline-light">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2.5">
              {f.type === "XLSX" ? (
                <FileSpreadsheet className="size-4 shrink-0 text-emerald-600" />
              ) : (
                <FileText className="size-4 shrink-0 text-red-500" />
              )}
              <button
                type="button"
                onClick={() => handleOpen(f.id)}
                disabled={isPending}
                className="min-w-0 flex-1 truncate text-left text-sm text-link-light underline-offset-4 hover:underline disabled:opacity-60"
              >
                {f.name}
              </button>
              <span className="shrink-0 text-xs text-mute-light">{f.type}</span>
              <span className="shrink-0 text-xs tabular-nums text-mute-light">{f.date}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
