"use client";

// 顧客詳細「新規記録」ダイアログ (F-031 / docs/04 §1.3).
// 商談履歴 1 件を作成する。種別は トスアップ / アポイント / コール / その他。
// 見積セクションから開いた場合（defaultCategory="quote"）は種別を「見積提示」固定にし、
// 金額入力欄を表示する。サーバ側ロジックは ./activity-actions（"use server"）。

import { Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { createCustomerActivity } from "./activity-actions";

import type { HistoryCategory } from "./data";

interface UserChoice {
  id: string;
  name: string;
}

interface NewActivityDialogProps {
  customerId: string;
  users?: UserChoice[]; // 担当者選択の候補（自社社員）
  defaultAssigneeUserId?: string | null; // 既定の担当者（既定はこの顧客のクロージング担当）
  defaultCategory?: HistoryCategory; // 初期選択カテゴリ（見積セクションからは "quote"）
  triggerLabel?: string; // トリガーボタンの文言（既定は「新規記録」）
}

const ASSIGNEE_UNSET = "__unset__";

// 種別の選択肢（見積提示はこの一覧には出さず、見積セクションから専用で記録する）。
const CATEGORY_CODES: HistoryCategory[] = ["tossup", "appointment", "phone", "other"];

// timezone-safe な「今日」（toISOString は UTC で日付がずれるため使わない）。
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function NewActivityDialog({
  customerId,
  users = [],
  defaultAssigneeUserId = null,
  defaultCategory = "tossup",
  triggerLabel,
}: NewActivityDialogProps) {
  const d = labels.customer.detail;
  const na = d.newActivity;
  const kinds = d.history.kinds;
  const c = labels.common;
  const router = useRouter();

  const isQuote = defaultCategory === "quote";

  // 既定担当者はクロージング担当（候補一覧に存在する自社社員のときのみ採用）。
  const initialAssignee =
    defaultAssigneeUserId && users.some((u) => u.id === defaultAssigneeUserId)
      ? defaultAssigneeUserId
      : ASSIGNEE_UNSET;

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [occurredAt, setOccurredAt] = useState(todayLocal());
  const [category, setCategory] = useState<HistoryCategory>(defaultCategory);
  const [assigneeUserId, setAssigneeUserId] = useState<string>(initialAssignee);
  const [detail, setDetail] = useState("");
  const [amount, setAmount] = useState("");

  function resetForm() {
    setOccurredAt(todayLocal());
    setCategory(defaultCategory);
    setAssigneeUserId(initialAssignee);
    setDetail("");
    setAmount("");
  }

  function onOpenChange(next: boolean) {
    if (next) resetForm();
    setOpen(next);
  }

  function handleSave() {
    if (!detail.trim()) {
      toast.error(na.detailPlaceholder);
      return;
    }
    startTransition(async () => {
      try {
        const amountNum = Math.floor(Number(amount));
        await createCustomerActivity({
          customerId,
          occurredAt,
          category,
          detail: detail.trim(),
          amount:
            category === "quote" && amount.trim() && Number.isFinite(amountNum) && amountNum >= 0
              ? amountNum
              : null,
          assigneeUserId: assigneeUserId === ASSIGNEE_UNSET ? null : assigneeUserId,
          tasks: [],
          files: [],
        });
        toast.success(c.saved);
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  const inputClass =
    "h-9 w-full rounded-sm border border-hairline-light bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus />
          {triggerLabel ?? d.history.newRecord}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isQuote ? d.quoteSection.record : na.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="activity-date">{na.date}</Label>
              <Input
                id="activity-date"
                type="date"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>
            {!isQuote ? (
              <div className="space-y-1.5">
                <Label htmlFor="activity-category">{na.category}</Label>
                <select
                  id="activity-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as HistoryCategory)}
                  className={inputClass}
                >
                  {CATEGORY_CODES.map((code) => (
                    <option key={code} value={code}>
                      {kinds[code]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="activity-assignee">{na.assignee}</Label>
              <select
                id="activity-assignee"
                value={assigneeUserId}
                onChange={(e) => setAssigneeUserId(e.target.value)}
                className={inputClass}
              >
                <option value={ASSIGNEE_UNSET}>{na.assigneeUnset}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isQuote ? (
            <div className="space-y-1.5">
              <Label htmlFor="activity-amount">{na.amount}</Label>
              <Input
                id="activity-amount"
                type="number"
                inputMode="numeric"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
              <p className="text-xs text-mute-light">{na.amountHint}</p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="activity-detail">{na.detail}</Label>
            <textarea
              id="activity-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={4}
              placeholder={isQuote ? na.detailPlaceholderQuote : na.detailPlaceholder}
              className="w-full resize-none rounded-sm border border-hairline-light bg-white px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {na.cancel}
          </Button>
          <Button type="button" onClick={handleSave} disabled={isPending}>
            {isPending ? c.saving : na.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
