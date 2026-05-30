"use client";

// 顧客詳細ページ 契約状況 / 施工状況 / 補助金申請状況カードのインライン編集
// ダイアログ (F-031 / docs/04 §1.3). 3 カードの値は Customer の手動列に保存される。
// 日付は <input type="date"> の YYYY-MM-DD を action に渡し、サーバ側で Date 化する。

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { updateCustomerAction } from "../actions";

import type {
  ContractStatusValue,
  ConstructionStatusValue,
  SubsidyStatusValue,
} from "../constants";
import type {
  ContractStatusCard,
  ConstructionStatusCard,
  SubsidyStatusCard,
} from "./data";

const SELECT_CLASS =
  "border border-cloud-gray bg-white text-carbon-dark rounded-sm px-3 py-2 text-sm h-10 w-full focus:outline-none focus:ring-2 focus:ring-electric-blue/20 focus:border-electric-blue transition-colors";

// ISO → YYYY-MM-DD using the date's LOCAL Y/M/D so JST never shifts the day.
function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function StatusDialogShell({
  title,
  trigger,
  open,
  onOpenChange,
  isPending,
  onSave,
  children,
}: {
  title: string;
  trigger: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  isPending: boolean;
  onSave: () => void;
  children: React.ReactNode;
}) {
  const d = labels.customer.detail;
  const c = labels.common;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-mute-light hover:text-ink"
          aria-label={trigger}
        >
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">{children}</div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {d.cancel}
          </Button>
          <Button type="button" onClick={onSave} disabled={isPending}>
            {isPending ? c.saving : d.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditContractStatusDialog({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ContractStatusCard;
}) {
  const t = labels.customer;
  const d = t.detail;
  const c = labels.common;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<ContractStatusValue>(initial.status);
  const [plan, setPlan] = useState(initial.plan ?? "");
  const [expectedDate, setExpectedDate] = useState(isoToDateInput(initial.expectedDate));

  function onOpenChange(next: boolean) {
    if (next) {
      setStatus(initial.status);
      setPlan(initial.plan ?? "");
      setExpectedDate(isoToDateInput(initial.expectedDate));
    }
    setOpen(next);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await updateCustomerAction({
          id: customerId,
          contractStatus: status,
          contractPlan: plan,
          contractExpectedDate: expectedDate || null,
        });
        toast.success(c.saved);
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <StatusDialogShell
      title={d.editContract}
      trigger={d.editContract}
      open={open}
      onOpenChange={onOpenChange}
      isPending={isPending}
      onSave={handleSave}
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-contract-status">{d.cards.contract}</Label>
        <select
          id="edit-contract-status"
          className={SELECT_CLASS}
          value={status}
          onChange={(e) => setStatus(e.target.value as ContractStatusValue)}
        >
          <option value="negotiating">{t.contractStatusLabels.negotiating}</option>
          <option value="contracted">{t.contractStatusLabels.contracted}</option>
          <option value="lost">{t.contractStatusLabels.lost}</option>
          <option value="cancelled">{t.contractStatusLabels.cancelled}</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-contract-plan">{d.contractFields.plan}</Label>
        <Input
          id="edit-contract-plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-contract-expected">{d.contractFields.expectedDate}</Label>
        <Input
          id="edit-contract-expected"
          type="date"
          value={expectedDate}
          onChange={(e) => setExpectedDate(e.target.value)}
        />
      </div>
    </StatusDialogShell>
  );
}

export function EditConstructionStatusDialog({
  customerId,
  initial,
}: {
  customerId: string;
  initial: ConstructionStatusCard;
}) {
  const t = labels.customer;
  const d = t.detail;
  const c = labels.common;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<ConstructionStatusValue>(initial.status);
  const [plannedDate, setPlannedDate] = useState(isoToDateInput(initial.plannedDate));
  const [completedDate, setCompletedDate] = useState(isoToDateInput(initial.completedDate));

  function onOpenChange(next: boolean) {
    if (next) {
      setStatus(initial.status);
      setPlannedDate(isoToDateInput(initial.plannedDate));
      setCompletedDate(isoToDateInput(initial.completedDate));
    }
    setOpen(next);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await updateCustomerAction({
          id: customerId,
          constructionStatus: status,
          constructionPlannedDate: plannedDate || null,
          constructionCompletedDate: completedDate || null,
        });
        toast.success(c.saved);
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <StatusDialogShell
      title={d.editConstruction}
      trigger={d.editConstruction}
      open={open}
      onOpenChange={onOpenChange}
      isPending={isPending}
      onSave={handleSave}
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-construction-status">{d.cards.construction}</Label>
        <select
          id="edit-construction-status"
          className={SELECT_CLASS}
          value={status}
          onChange={(e) => setStatus(e.target.value as ConstructionStatusValue)}
        >
          <option value="not_started">{t.constructionStatusLabels.not_started}</option>
          <option value="in_progress">{t.constructionStatusLabels.in_progress}</option>
          <option value="done">{t.constructionStatusLabels.done}</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-construction-planned">{d.constructionFields.plannedDate}</Label>
        <Input
          id="edit-construction-planned"
          type="date"
          value={plannedDate}
          onChange={(e) => setPlannedDate(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-construction-completed">{d.constructionFields.completedDate}</Label>
        <Input
          id="edit-construction-completed"
          type="date"
          value={completedDate}
          onChange={(e) => setCompletedDate(e.target.value)}
        />
      </div>
    </StatusDialogShell>
  );
}

export function EditSubsidyStatusDialog({
  customerId,
  initial,
}: {
  customerId: string;
  initial: SubsidyStatusCard;
}) {
  const t = labels.customer;
  const d = t.detail;
  const c = labels.common;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<SubsidyStatusValue>(initial.status);
  const [type, setType] = useState(initial.type ?? "");
  const [submittedDate, setSubmittedDate] = useState(isoToDateInput(initial.submittedDate));
  const [grantedDate, setGrantedDate] = useState(isoToDateInput(initial.grantedDate));

  function onOpenChange(next: boolean) {
    if (next) {
      setStatus(initial.status);
      setType(initial.type ?? "");
      setSubmittedDate(isoToDateInput(initial.submittedDate));
      setGrantedDate(isoToDateInput(initial.grantedDate));
    }
    setOpen(next);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await updateCustomerAction({
          id: customerId,
          subsidyStatus: status,
          subsidyType: type,
          subsidySubmittedDate: submittedDate || null,
          subsidyGrantedDate: grantedDate || null,
        });
        toast.success(c.saved);
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : c.unknownError);
      }
    });
  }

  return (
    <StatusDialogShell
      title={d.editSubsidy}
      trigger={d.editSubsidy}
      open={open}
      onOpenChange={onOpenChange}
      isPending={isPending}
      onSave={handleSave}
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-subsidy-status">{d.cards.subsidy}</Label>
        <select
          id="edit-subsidy-status"
          className={SELECT_CLASS}
          value={status}
          onChange={(e) => setStatus(e.target.value as SubsidyStatusValue)}
        >
          <option value="none">{t.subsidyStatusLabels.none}</option>
          <option value="applying">{t.subsidyStatusLabels.applying}</option>
          <option value="granted">{t.subsidyStatusLabels.granted}</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-subsidy-type">{d.subsidyFields.type}</Label>
        <Input
          id="edit-subsidy-type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-subsidy-submitted">{d.subsidyFields.submittedDate}</Label>
        <Input
          id="edit-subsidy-submitted"
          type="date"
          value={submittedDate}
          onChange={(e) => setSubmittedDate(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-subsidy-granted">{d.subsidyFields.grantedDate}</Label>
        <Input
          id="edit-subsidy-granted"
          type="date"
          value={grantedDate}
          onChange={(e) => setGrantedDate(e.target.value)}
        />
      </div>
    </StatusDialogShell>
  );
}
