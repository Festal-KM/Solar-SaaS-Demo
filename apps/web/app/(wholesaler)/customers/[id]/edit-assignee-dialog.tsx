"use client";

// 顧客詳細ページ ヘッダーの担当者変更ダイアログ (F-031 / docs/04 §1.3).
// 「トスアップ担当」「クロージング担当」を、自社社員(User) または二次店(Relationship)
// から選んで更新する。各役割は自社/二次店いずれか一方（排他）で、「未設定」も可。
// option の value は種別を埋め込んだ `user:<id>` / `dealer:<relId>` 形式。

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

interface DealerChoice {
  relationshipId: string;
  dealerName: string;
}

interface EditAssigneeDialogProps {
  customerId: string;
  currentTossUpUserId: string | null;
  currentTossUpRelationshipId: string | null;
  currentClosingUserId: string | null;
  currentClosingRelationshipId: string | null;
  users: UserChoice[];
  dealers: DealerChoice[];
}

const UNSET = "__unset__";

// 現在値 → select の value（種別プレフィックス付き）。
function toValue(userId: string | null, relationshipId: string | null): string {
  if (relationshipId) return `dealer:${relationshipId}`;
  if (userId) return `user:${userId}`;
  return UNSET;
}

// select の value → 保存用の {userId, relationshipId}（排他、未選択側は null）。
function fromValue(value: string): { userId: string | null; relationshipId: string | null } {
  if (value.startsWith("dealer:")) return { userId: null, relationshipId: value.slice(7) };
  if (value.startsWith("user:")) return { userId: value.slice(5), relationshipId: null };
  return { userId: null, relationshipId: null };
}

export function EditAssigneeDialog({
  customerId,
  currentTossUpUserId,
  currentTossUpRelationshipId,
  currentClosingUserId,
  currentClosingRelationshipId,
  users,
  dealers,
}: EditAssigneeDialogProps) {
  const d = labels.customer.detail;
  const c = labels.common;
  const router = useRouter();

  const tossUpInitial = toValue(currentTossUpUserId, currentTossUpRelationshipId);
  const closingInitial = toValue(currentClosingUserId, currentClosingRelationshipId);

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [tossUp, setTossUp] = useState(tossUpInitial);
  const [closing, setClosing] = useState(closingInitial);

  function onOpenChange(next: boolean) {
    if (next) {
      setTossUp(tossUpInitial);
      setClosing(closingInitial);
    }
    setOpen(next);
  }

  function handleSave() {
    const tu = fromValue(tossUp);
    const cl = fromValue(closing);
    startTransition(async () => {
      try {
        await updateCustomerAction({
          id: customerId,
          tossUpUserId: tu.userId,
          tossUpRelationshipId: tu.relationshipId,
          closingUserId: cl.userId,
          closingRelationshipId: cl.relationshipId,
        });
        toast.success(c.saved);
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  const selectClass =
    "h-9 w-full rounded-sm border border-hairline-light bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

  function AssigneeSelect({
    id,
    label,
    value,
    onChange,
  }: {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
          <option value={UNSET}>{d.unassigned}</option>
          <optgroup label={d.ownStaffGroup}>
            {users.map((u) => (
              <option key={u.id} value={`user:${u.id}`}>
                {u.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={d.dealerGroup}>
            {dealers.map((dl) => (
              <option key={dl.relationshipId} value={`dealer:${dl.relationshipId}`}>
                {dl.dealerName}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
    );
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
        <div className="space-y-4">
          <AssigneeSelect
            id="edit-tossup-select"
            label={d.fields.tossUpAssignee}
            value={tossUp}
            onChange={setTossUp}
          />
          <AssigneeSelect
            id="edit-closing-select"
            label={d.fields.closingAssignee}
            value={closing}
            onChange={setClosing}
          />
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
