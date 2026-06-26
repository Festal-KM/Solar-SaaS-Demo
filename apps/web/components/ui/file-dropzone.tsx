"use client";

// 共通ファイルドロップゾーン — ネイティブ HTML5 drag&drop + 隠し input。
// 実アップロードは onFiles コールバックに委譲し、UI（ドロップゾーン・チップ・進行表示）のみ担う。
// 隠し input の id は親から受け取り維持する（E2E は setInputFiles で直接叩くため）。

import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import { labels } from "@/lib/i18n/labels";
import { cn } from "@/lib/utils";

interface FileDropzoneProps {
  inputId: string;
  onFiles: (files: File[]) => void | Promise<void>;
  uploadingNames: string[];
  isUploading: boolean;
  inputAriaLabel?: string;
  compact?: boolean;
}

export function FileDropzone({
  inputId,
  onFiles,
  uploadingNames,
  isUploading,
  inputAriaLabel,
  compact = false,
}: FileDropzoneProps) {
  const t = labels.customer.detail.fileDropzone;
  const u = labels.customer.detail.newActivity;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function openPicker() {
    inputRef.current?.click();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length > 0) void onFiles(dropped);
  }

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        aria-label={inputAriaLabel ?? t.primary}
        onClick={openPicker}
        onKeyDown={handleKeyDown}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
        }}
        onDrop={handleDrop}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center justify-center rounded-md border border-dashed text-center transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1",
          compact ? "gap-1 px-3 py-4" : "gap-1.5 px-4 py-7",
          dragActive
            ? "border-primary bg-primary/5"
            : "border-ash-light bg-surface-soft hover:border-primary/60 hover:bg-primary/5",
        )}
      >
        <Upload
          className={cn(
            "text-mute-light",
            compact ? "size-4" : "size-5",
            dragActive && "text-primary",
          )}
        />
        <p className={cn("font-medium text-ink", compact ? "text-xs" : "text-sm")}>
          {dragActive ? t.dragActive : t.primary}
        </p>
        {!dragActive ? (
          <p className={cn("text-mute-light", compact ? "text-[10px]" : "text-xs")}>
            {t.secondary}
          </p>
        ) : null}
        <p className={cn("text-mute-light", compact ? "text-[10px]" : "text-xs")}>{t.hint}</p>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        aria-label={inputAriaLabel ?? t.primary}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length > 0) void onFiles(picked);
          e.target.value = "";
        }}
        className="sr-only"
      />

      {uploadingNames.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {uploadingNames.map((name, i) => (
            <li
              key={`${name}-${i}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
            >
              <Upload className="size-3 shrink-0 animate-pulse" />
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {isUploading ? (
        <p
          className={cn(
            "flex items-center gap-1.5 text-mute-light",
            compact ? "text-[10px]" : "text-xs",
          )}
        >
          <Upload className={cn("animate-pulse", compact ? "size-3" : "size-3.5")} />
          {u.uploading}
        </p>
      ) : null}
    </div>
  );
}
