"use client";

// 関連ファイルタブ — ファイルピッカーで R2 へ直接アップロードし、CustomerFile を記録。
// 既存ファイルはファイル名クリックで pre-signed GET URL を取得し別タブで開く
// (F-031 / docs/04 §1.3). data.ts（server-only）の実行時値は import しない（型のみ）。

import { FileSpreadsheet, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FileDropzone } from "@/components/ui/file-dropzone";
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
  // GENERAL=関連ファイルタブ、APPLICATION=設置申請タブの申請関連ドキュメント、
  // PV_DRAWING=施工状況タブの PV設置図面、CONTRACT=契約状況タブの契約関連ファイル。
  category?: "GENERAL" | "APPLICATION" | "PV_DRAWING" | "CONTRACT";
}

export function CustomerFiles({ customerId, files, category = "GENERAL" }: CustomerFilesProps) {
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
          category,
        });
        const res = await fetch(putUrl, { method: "PUT", headers, body: file });
        if (!res.ok) throw new Error(`アップロードに失敗しました（${res.status}）`);
        await createCustomerFile({
          customerId,
          fileKey,
          fileName: file.name,
          contentType: file.type || null,
          size: file.size,
          category,
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
    <div className="space-y-4">
      {/* ファイルピッカー */}
      <FileDropzone
        inputId={`customer-file-input-${category.toLowerCase()}`}
        onFiles={handleFilesSelected}
        uploadingNames={uploadingNames}
        isUploading={uploadingNames.length > 0}
      />

      {/* 一覧 */}
      {files.length === 0 ? (
        <p className="text-sm text-mute-light">
          {category === "APPLICATION"
            ? d.applicationFiles.empty
            : category === "PV_DRAWING"
              ? d.pvDrawing.empty
              : category === "CONTRACT"
                ? d.contractFiles.empty
                : d.files.empty}
        </p>
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
