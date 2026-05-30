"use client";

// Dialog for issuing a new invite code (F-010).
// Plaintext code is shown once after generation.

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { generateInviteCodeAction } from "./actions";

export function GenerateInviteCodeDialog() {
  const t = labels.relationshipManagement;
  const [open, setOpen] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!expiresAt) {
      toast.error(t.errors.expiresAtRequired);
      return;
    }
    setGenerating(true);
    try {
      const result = await generateInviteCodeAction({ expiresAt, maxUses });
      setGeneratedCode(result.code);
      toast.success(t.feedback.codeGenerated);
    } catch {
      toast.error(labels.common.unknownError);
    } finally {
      setGenerating(false);
    }
  }

  function handleCopy() {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode).then(() => {
        toast.success(t.inviteCodeCopied);
      });
    }
  }

  function handleClose() {
    setOpen(false);
    setGeneratedCode(null);
    setExpiresAt("");
    setMaxUses(1);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button variant="outline">{t.actions.generateCode}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.inviteCodeDialogTitle}</DialogTitle>
          <DialogDescription>{t.inviteCodeDialogDescription}</DialogDescription>
        </DialogHeader>

        {generatedCode ? (
          <div className="space-y-4">
            <p className="text-sm font-medium">{t.inviteCodeResult}</p>
            <div className="bg-muted flex items-center justify-between rounded-md px-4 py-3">
              <span className="font-mono text-lg tracking-wider">{generatedCode}</span>
              <Button size="sm" variant="outline" onClick={handleCopy}>
                コピー
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">{t.inviteCodeResultNote}</p>
            <DialogFooter>
              <Button onClick={handleClose}>{labels.common.cancel}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="invite-expires">{t.fields.inviteCodeExpiresAt}</Label>
              <Input
                id="invite-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-max-uses">{t.fields.inviteCodeMaxUses}</Label>
              <Input
                id="invite-max-uses"
                type="number"
                min={1}
                max={100}
                value={maxUses}
                onChange={(e) => setMaxUses(Number(e.target.value))}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={generating}>
                {generating ? t.actions.generating : t.actions.generateCode}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
