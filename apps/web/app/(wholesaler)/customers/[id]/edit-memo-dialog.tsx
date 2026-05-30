"use client";

// 顧客詳細ページ メモカードのインライン編集ダイアログ (F-031 / docs/04 §1.3).

import { Pencil } from "lucide-react";
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
import { labels } from "@/lib/i18n/labels";

import { updateCustomerAction } from "../actions";

interface EditMemoDialogProps {
  customerId: string;
  initial: { note: string | null };
}

export function EditMemoDialog({ customerId, initial }: EditMemoDialogProps) {
  const d = labels.customer.detail;
  const c = labels.common;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState(initial.note ?? "");

  function onOpenChange(next: boolean) {
    if (next) setNote(initial.note ?? "");
    setOpen(next);
  }

  function handleSave() {
    const trimmed = note.trim();
    startTransition(async () => {
      try {
        await updateCustomerAction({ id: customerId, note: trimmed ? trimmed : undefined });
        toast.success(c.saved);
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-mute-light hover:text-ink"
          aria-label={d.editMemo}
        >
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.editMemo}</DialogTitle>
        </DialogHeader>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={6}
          className="w-full resize-none rounded-sm border border-hairline-light bg-white px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {d.cancel}
          </Button>
          <Button type="button" onClick={handleSave} disabled={isPending}>
            {isPending ? c.saving : d.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
