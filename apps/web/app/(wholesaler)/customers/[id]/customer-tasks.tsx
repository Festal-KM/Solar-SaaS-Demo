"use client";

// ToDo タブ — タスク一覧 + 新規起票（CustomerTask を直接作成）。
// data.ts（server-only）の実行時値は import しない（型のみ）。

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

import { createCustomerTask } from "./activity-actions";

import type { CustomerTask } from "./data";

interface UserChoice {
  id: string;
  name: string;
}

interface CustomerTasksProps {
  customerId: string;
  tasks: CustomerTask[];
  users: UserChoice[];
}

export function CustomerTasks({ customerId, tasks, users }: CustomerTasksProps) {
  const d = labels.customer.detail;
  const na = d.newActivity;
  const c = labels.common;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [content, setContent] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");

  function onOpenChange(next: boolean) {
    if (next) {
      setContent("");
      setDueDate("");
      setAssigneeUserId("");
    }
    setOpen(next);
  }

  function handleSave() {
    if (!content.trim()) {
      toast.error(na.taskContent);
      return;
    }
    startTransition(async () => {
      try {
        await createCustomerTask({
          customerId,
          content: content.trim(),
          dueDate: dueDate || null,
          assigneeUserId: assigneeUserId || null,
        });
        toast.success(c.saved);
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  const fieldClass =
    "h-9 w-full rounded-sm border border-hairline-light bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{d.tasks.title}</h2>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Plus />
              {na.addTask}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{na.addTask}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="task-content">{na.taskContent}</Label>
                <Input
                  id="task-content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="task-due">{na.taskDue}</Label>
                  <input
                    id="task-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="task-assignee">{na.taskAssignee}</Label>
                  <select
                    id="task-assignee"
                    value={assigneeUserId}
                    onChange={(e) => setAssigneeUserId(e.target.value)}
                    className={fieldClass}
                  >
                    <option value="">{d.unassigned}</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                {c.cancel}
              </Button>
              <Button type="button" onClick={handleSave} disabled={isPending}>
                {isPending ? c.saving : c.save}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-mute-light">{d.tasks.empty}</p>
      ) : (
        <ul className="divide-y divide-hairline-light">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-3 py-2.5">
              <input
                type="checkbox"
                checked={task.done}
                readOnly
                disabled
                className="size-4 shrink-0 rounded border-hairline-light"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{task.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-mute-light">{task.due}</span>
              <span className="shrink-0 text-xs text-mute-light">{task.assignee}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
