"use client";

// 顧客詳細ページ ヘッダーの担当者変更ダイアログ (F-031 / docs/04 §1.3).
// 自社の ACTIVE ユーザーから選び、registeredByUserId を更新する。

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
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { updateCustomerAction } from "../actions";

interface UserChoice {
  id: string;
  name: string;
}

interface EditAssigneeDialogProps {
  customerId: string;
  currentUserId: string;
  users: UserChoice[];
}

export function EditAssigneeDialog({ customerId, currentUserId, users }: EditAssigneeDialogProps) {
  const d = labels.customer.detail;
  const c = labels.common;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState(currentUserId);

  function onOpenChange(next: boolean) {
    if (next) setSelected(currentUserId);
    setOpen(next);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await updateCustomerAction({ id: customerId, registeredByUserId: selected });
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
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs">
          {d.changeAssignee}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{d.editAssignee}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="edit-assignee-select">{d.assigneeLabel}</Label>
          <select
            id="edit-assignee-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="h-9 w-full rounded-sm border border-hairline-light bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
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
