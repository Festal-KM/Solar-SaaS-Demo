"use client";

// 関連ファイルタイル — ファイル名クリックで pre-signed GET URL を取得し別タブで開く
// (F-031 / docs/04 §1.3). data.ts（server-only）の実行時値は import しない（型のみ）。

import { FileSpreadsheet, FileText } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { labels } from "@/lib/i18n/labels";

import { getCustomerFileDownloadUrl } from "./activity-actions";
import type { RelatedFile } from "./data";

interface CustomerFilesProps {
  files: RelatedFile[];
}

export function CustomerFiles({ files }: CustomerFilesProps) {
  const d = labels.customer.detail;
  const c = labels.common;
  const [isPending, startTransition] = useTransition();

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

  if (files.length === 0) {
    return <p className="text-sm text-mute-light">{d.files.empty}</p>;
  }

  return (
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
  );
}
