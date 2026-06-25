"use client";

// 見積セクション — 見積提示アクティビティ（category="quote"）に紐づく見積書ファイルの
// アップロード/一覧。R2 へ直接 PUT し、CustomerActivityFile（category=QUOTE）を記録する。
// ファイル名クリックで pre-signed GET URL を取得し別タブで開く。

import { FileSpreadsheet, FileText, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { labels } from "@/lib/i18n/labels";

import {
  createCustomerActivityFile,
  getCustomerFileDownloadUrl,
  presignCustomerFileUpload,
} from "./activity-actions";

import type { RelatedFile } from "./data";

interface QuoteFilesProps {
  customerId: string;
  activityId: string;
  files: RelatedFile[];
}

export function QuoteFiles({ customerId, activityId, files }: QuoteFilesProps) {
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
          category: "QUOTE",
        });
        const res = await fetch(putUrl, { method: "PUT", headers, body: file });
        if (!res.ok) throw new Error(`アップロードに失敗しました（${res.status}）`);
        await createCustomerActivityFile({
          customerId,
          activityId,
          fileKey,
          fileName: file.name,
          contentType: file.type || null,
          size: file.size,
          category: "QUOTE",
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
    <div className="mt-2 space-y-2 border-t border-hairline-light pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-mute-light">{d.quoteSection.files}</span>
        {uploadingCount > 0 ? (
          <span className="flex items-center gap-1 text-xs text-mute-light">
            <Upload className="size-3 animate-pulse" />
            {d.newActivity.uploading}
          </span>
        ) : null}
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-mute-light">{d.quoteSection.noFiles}</p>
      ) : (
        <ul className="divide-y divide-hairline-light">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 py-1.5">
              {f.type === "XLSX" ? (
                <FileSpreadsheet className="size-3.5 shrink-0 text-emerald-600" />
              ) : (
                <FileText className="size-3.5 shrink-0 text-red-500" />
              )}
              <button
                type="button"
                onClick={() => handleOpen(f.id)}
                disabled={isPending}
                className="min-w-0 flex-1 truncate text-left text-xs text-link-light underline-offset-4 hover:underline disabled:opacity-60"
              >
                {f.name}
              </button>
              <span className="shrink-0 text-[10px] tabular-nums text-mute-light">{f.date}</span>
            </li>
          ))}
        </ul>
      )}

      <input
        id={`quote-file-input-${activityId}`}
        type="file"
        multiple
        onChange={(e) => {
          void handleFilesSelected(e.target.files);
          e.target.value = "";
        }}
        aria-label={d.quoteSection.addFile}
        className="block w-full text-xs text-body-light file:mr-2 file:rounded-sm file:border file:border-hairline-light file:bg-white file:px-2 file:py-1 file:text-xs file:text-ink hover:file:bg-slate-50"
      />
    </div>
  );
}
