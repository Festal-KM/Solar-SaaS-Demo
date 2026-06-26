"use client";

// 見積セクション — 見積提示アクティビティ（category="quote"）に紐づく見積書ファイルの
// アップロード/一覧。R2 へ直接 PUT し、CustomerActivityFile（category=QUOTE）を記録する。
// ファイル名クリックで pre-signed GET URL を取得し別タブで開く。

import { FileSpreadsheet, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FileDropzone } from "@/components/ui/file-dropzone";
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
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);

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

  async function handleFilesSelected(picked: File[]) {
    if (picked.length === 0) return;
    let recorded = false;
    for (const file of picked) {
      setUploadingNames((prev) => [...prev, file.name]);
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
        setUploadingNames((prev) => {
          const i = prev.indexOf(file.name);
          if (i < 0) return prev;
          return [...prev.slice(0, i), ...prev.slice(i + 1)];
        });
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

      <FileDropzone
        inputId={`quote-file-input-${activityId}`}
        onFiles={handleFilesSelected}
        uploadingNames={uploadingNames}
        isUploading={false}
        inputAriaLabel={d.quoteSection.addFile}
        compact
      />
    </div>
  );
}
