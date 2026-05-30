"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { labels } from "@/lib/i18n/labels";

import { updateLineAssignAction } from "./actions";

import type { DealerOption, LineAssigneeRow, WholesalerUserOption } from "../data";

type AssignMode = "SELF" | "DEALER" | "JOINT";
type AssignStatus = "CONFIRMED" | "ADJUSTING";

interface LineAssignSectionProps {
  lineEventId: string;
  assignMode: string | null;
  assignStatus: AssignStatus | null;
  assignStaffIds: string[];
  assignDealerIds: string[];
  assignees: LineAssigneeRow[];
  assignNote: string | null;
  wholesalerUsers: WholesalerUserOption[];
  dealers: DealerOption[];
}

function statusToHolding(s: AssignStatus): "confirmed" | "adjusting" {
  return s === "CONFIRMED" ? "confirmed" : "adjusting";
}

function StatusSelect({
  value,
  onChange,
}: {
  value: "confirmed" | "adjusting";
  onChange: (v: "confirmed" | "adjusting") => void;
}) {
  const tl = labels.eventList;
  const colors =
    value === "confirmed"
      ? "bg-primary/10 text-primary border-primary/30"
      : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as "confirmed" | "adjusting")}
      className={[
        "appearance-none rounded-full border px-3 py-0.5 text-xs font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30",
        colors,
      ].join(" ")}
    >
      <option value="confirmed">{tl.assignStatusOptions.confirmed}</option>
      <option value="adjusting">{tl.assignStatusOptions.adjusting}</option>
    </select>
  );
}

function ModeButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex-1 rounded-md px-4 py-3 text-sm font-medium transition-colors border",
        selected
          ? "border-primary bg-primary text-white"
          : "border-hairline-light bg-white text-ink hover:border-primary/40 hover:bg-primary/5",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export function LineAssignSection({
  lineEventId,
  assignMode,
  assignStatus,
  assignStaffIds,
  assignDealerIds,
  assignees,
  assignNote,
  wholesalerUsers,
  dealers,
}: LineAssignSectionProps) {
  const t = labels.lineEvent;
  const tl = labels.eventList;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<AssignMode>((assignMode as AssignMode) ?? "SELF");
  const [selectedStaff, setSelectedStaff] = useState<string[]>(assignStaffIds);
  const [selectedDealers, setSelectedDealers] = useState<string[]>(assignDealerIds);
  const [assignMemo, setAssignMemo] = useState(assignNote ?? "");
  const [dialogStatus, setDialogStatus] = useState<"confirmed" | "adjusting">(
    statusToHolding(assignStatus ?? "ADJUSTING"),
  );
  const [headerStatus, setHeaderStatus] = useState<"confirmed" | "adjusting">(
    statusToHolding(assignStatus ?? "ADJUSTING"),
  );

  const toggleStaff = useCallback((userId: string) => {
    setSelectedStaff((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }, []);

  const toggleDealer = useCallback((relId: string) => {
    setSelectedDealers((prev) =>
      prev.includes(relId) ? prev.filter((id) => id !== relId) : [...prev, relId],
    );
  }, []);

  function persist(next: {
    mode: AssignMode;
    staffIds: string[];
    dealerIds: string[];
    status: "confirmed" | "adjusting";
    note: string;
  }) {
    startTransition(async () => {
      try {
        await updateLineAssignAction({
          id: lineEventId,
          assignMode: next.mode,
          assignStaffIds: next.staffIds,
          assignDealerIds: next.dealerIds,
          assignStatus: next.status === "confirmed" ? "CONFIRMED" : "ADJUSTING",
          assignNote: next.note,
        });
        toast.success(labels.common.saved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : labels.common.unknownError);
      }
    });
  }

  // Header chip changes persist immediately so the assign status is editable
  // even without re-opening the dialog (要件: アサインステータスも編集可能).
  function handleHeaderStatusChange(v: "confirmed" | "adjusting") {
    setHeaderStatus(v);
    setDialogStatus(v);
    persist({
      mode: selectedMode,
      staffIds: selectedStaff,
      dealerIds: selectedDealers,
      status: v,
      note: assignMemo,
    });
  }

  function handleSave() {
    setHeaderStatus(dialogStatus);
    setOpen(false);
    persist({
      mode: selectedMode,
      staffIds: selectedMode === "SELF" || selectedMode === "JOINT" ? selectedStaff : [],
      dealerIds: selectedMode === "DEALER" || selectedMode === "JOINT" ? selectedDealers : [],
      status: dialogStatus,
      note: assignMemo,
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base whitespace-nowrap">{t.sections.assign}</CardTitle>
            <StatusSelect value={headerStatus} onChange={handleHeaderStatusChange} />
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">{tl.addAssign}</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{tl.assignDialogTitle}</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 mt-2">
                <div>
                  <p className="text-xs font-medium text-mute-light mb-2">{tl.assignModeLabel}</p>
                  <div className="flex gap-2">
                    <ModeButton label={tl.assignModeSelf} selected={selectedMode === "SELF"} onClick={() => setSelectedMode("SELF")} />
                    <ModeButton label={tl.assignModeDealer} selected={selectedMode === "DEALER"} onClick={() => setSelectedMode("DEALER")} />
                    <ModeButton label={tl.assignModeJoint} selected={selectedMode === "JOINT"} onClick={() => setSelectedMode("JOINT")} />
                  </div>
                </div>

                {(selectedMode === "SELF" || selectedMode === "JOINT") && (
                  <div>
                    <p className="text-xs font-medium text-mute-light mb-2">{tl.assignSelectStaff}</p>
                    <div className="border border-hairline-light rounded-md max-h-48 overflow-y-auto">
                      {wholesalerUsers.map((u) => (
                        <label key={u.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-soft/50 cursor-pointer border-b border-hairline-light last:border-b-0">
                          <input type="checkbox" checked={selectedStaff.includes(u.id)} onChange={() => toggleStaff(u.id)} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30" />
                          <span className="text-sm text-ink">{u.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {(selectedMode === "DEALER" || selectedMode === "JOINT") && (
                  <div>
                    <p className="text-xs font-medium text-mute-light mb-2">{tl.assignDealerName}</p>
                    <div className="border border-hairline-light rounded-md max-h-48 overflow-y-auto">
                      {dealers.map((d) => (
                        <label key={d.relationshipId} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-soft/50 cursor-pointer border-b border-hairline-light last:border-b-0">
                          <input type="checkbox" checked={selectedDealers.includes(d.relationshipId)} onChange={() => toggleDealer(d.relationshipId)} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30" />
                          <span className="text-sm text-ink">{d.dealerName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium text-mute-light mb-2">{tl.assignOverallStatus}</p>
                  <StatusSelect value={dialogStatus} onChange={setDialogStatus} />
                </div>

                <div>
                  <p className="text-xs font-medium text-mute-light mb-2">{tl.assignMemo}</p>
                  <textarea value={assignMemo} onChange={(e) => setAssignMemo(e.target.value)} placeholder={tl.assignMemoPlaceholder} rows={3} className="w-full rounded-md border border-hairline-light bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
                </div>

                <Button className="w-full" onClick={handleSave} disabled={isPending}>
                  {isPending ? labels.common.saving : tl.assignSave}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {assignees.length > 0 ? (
          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline-light">
                    <th className="px-3 py-2 text-left text-xs font-medium text-mute-light">{tl.assignColumns.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {assignees.map((a) => (
                    <tr key={`${a.affiliation}-${a.id}`} className="border-b border-hairline-light last:border-b-0">
                      <td className="px-3 py-2.5 text-sm text-ink">
                        <span className="font-medium">{a.name}</span>
                        <span className="ml-2 text-xs text-mute-light">
                          ({a.affiliation === "self" ? tl.affiliationSelf : tl.affiliationDealer})
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="w-1/3 shrink-0 border-l border-hairline-light pl-4">
              <p className="text-xs font-medium text-mute-light mb-1">{tl.assignMemo}</p>
              <p className="text-sm text-ink whitespace-pre-wrap">{assignNote || "—"}</p>
            </div>
          </div>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-mute-light">{tl.assignNotAvailable}</p>
        )}
      </CardContent>
    </Card>
  );
}
