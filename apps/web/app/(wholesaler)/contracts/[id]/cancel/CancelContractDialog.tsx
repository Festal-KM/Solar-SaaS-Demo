"use client";

// CancelContractDialog — T-06-04 / F-043 / docs/04 §S-040 §S-041.
//
// Shows a confirmation dialog with a reason textarea before calling
// cancelContractAction. Displays a deadline notice (within / past) so the
// user understands the consequence before confirming.

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { cancelContractAction } from "./actions";

interface CancelContractDialogProps {
  contractId: string;
  cancelDeadline: Date;
}

export function CancelContractDialog({ contractId, cancelDeadline }: CancelContractDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const t = labels.contract.cancel;

  const isWithinDeadline = new Date() <= cancelDeadline;

  async function handleConfirm() {
    if (!reason.trim()) return;
    setPending(true);
    try {
      const result = await cancelContractAction({ contractId, reason: reason.trim() });
      setOpen(false);
      toast.success(result.isWithinDeadline ? t.successWithin : t.successAfter);
    } catch (err) {
      const msg = err instanceof Error ? err.message : labels.common.unknownError;
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          {t.buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{t.dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className={`text-sm ${isWithinDeadline ? "text-amber-600" : "text-destructive"}`}>
            {isWithinDeadline ? t.withinDeadlineNotice : t.afterDeadlineNotice}
          </p>

          <div className="space-y-1">
            <Label htmlFor="cancel-reason">{t.reasonLabel}</Label>
            <textarea
              id="cancel-reason"
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={t.reasonPlaceholder}
              value={reason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              rows={3}
              disabled={pending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {labels.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending || !reason.trim()}
          >
            {pending ? t.confirming : t.confirmButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
