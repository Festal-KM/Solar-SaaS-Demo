"use client";

// ConstructionForm — client component for S-046 施工管理 (T-05-10 / F-044).
//
// Panels:
//   1. New construction registration (create).
//   2. For each existing construction: status change + cost/note update.
//
// Fee change automatically triggers gross-profit recalc on the server side
// (handled inside updateConstructionAction — docs/02 §F-044 受入基準).

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";
import type { ConstructionStatus } from "@solar/db";
import { VALID_CONSTRUCTION_TRANSITIONS } from "@solar/contracts";

import {
  createConstructionAction,
  updateConstructionAction,
  changeConstructionStatusAction,
  type ConstructionResult,
} from "./actions";

interface InstallerOption {
  id: string;
  name: string;
}

interface ConstructionRow {
  id: string;
  status: ConstructionStatus;
  installerId: string | null;
  installerName: string | null;
  fee: string | null;
  surveyDate: string | null;
  plannedDate: string | null;
  completedDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  contractId: string;
  constructions: ConstructionRow[];
  installers: InstallerOption[];
}

export function ConstructionForm({ contractId, constructions: initial, installers }: Props) {
  const t = labels.construction;
  const c = labels.common;

  const [constructions, setConstructions] = useState<ConstructionRow[]>(initial);
  const [isPending, startTransition] = useTransition();

  // ----- Create form state -----
  const [createInstallerId, setCreateInstallerId] = useState("");
  const [createFee, setCreateFee] = useState("0");
  const [createSurveyDate, setCreateSurveyDate] = useState("");
  const [createPlannedDate, setCreatePlannedDate] = useState("");
  const [createNote, setCreateNote] = useState("");

  function applyResult(result: ConstructionResult) {
    setConstructions((prev) => {
      const idx = prev.findIndex((c) => c.id === result.id);
      const row: ConstructionRow = {
        ...result,
        installerName:
          installers.find((i) => i.id === result.installerId)?.name ?? null,
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = row;
        return next;
      }
      return [...prev, row];
    });
  }

  function handleCreate() {
    startTransition(async () => {
      try {
        const result = await createConstructionAction({
          contractId,
          installerId: createInstallerId || undefined,
          fee: createFee || "0",
          surveyDate: createSurveyDate || undefined,
          plannedDate: createPlannedDate || undefined,
          note: createNote || undefined,
        });
        applyResult(result);
        setCreateInstallerId("");
        setCreateFee("0");
        setCreateSurveyDate("");
        setCreatePlannedDate("");
        setCreateNote("");
        toast.success(t.feedback.created);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* ---- Per-construction edit panels ---- */}
      {constructions.map((con) => (
        <ConstructionEditPanel
          key={con.id}
          construction={con}
          installers={installers}
          isPending={isPending}
          onUpdate={(result) => {
            applyResult(result);
            toast.success(t.feedback.updated);
          }}
          onStatusChange={(result) => {
            applyResult(result);
            toast.success(t.feedback.statusChanged);
          }}
        />
      ))}

      {/* ---- Create new construction ---- */}
      <div className="border-border rounded-md border p-4 space-y-4">
        <h2 className="font-medium">{t.new}</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">{t.fields.installer}</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={createInstallerId}
              onChange={(e) => setCreateInstallerId(e.target.value)}
              disabled={isPending}
            >
              <option value="">{c.notSet}</option>
              {installers.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">{t.fields.fee}</label>
            <input
              type="text"
              inputMode="numeric"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={createFee}
              onChange={(e) => setCreateFee(e.target.value)}
              disabled={isPending}
              placeholder="0"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">{t.fields.surveyDate}</label>
            <input
              type="date"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={createSurveyDate}
              onChange={(e) => setCreateSurveyDate(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">{t.fields.plannedDate}</label>
            <input
              type="date"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={createPlannedDate}
              onChange={(e) => setCreatePlannedDate(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label className="text-sm text-muted-foreground">{t.fields.note}</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              value={createNote}
              onChange={(e) => setCreateNote(e.target.value)}
              disabled={isPending}
            />
          </div>
        </div>

        <Button onClick={handleCreate} disabled={isPending} size="sm">
          {isPending ? t.actions.creating : t.actions.create}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-construction edit + status-change panel
// ---------------------------------------------------------------------------

function ConstructionEditPanel({
  construction,
  installers,
  isPending,
  onUpdate,
  onStatusChange,
}: {
  construction: ConstructionRow;
  installers: InstallerOption[];
  isPending: boolean;
  onUpdate: (result: ConstructionResult) => void;
  onStatusChange: (result: ConstructionResult) => void;
}) {
  const t = labels.construction;
  const c = labels.common;

  const [installerId, setInstallerId] = useState(construction.installerId ?? "");
  const [fee, setFee] = useState(construction.fee ?? "0");
  const [surveyDate, setSurveyDate] = useState(
    construction.surveyDate ? construction.surveyDate.slice(0, 10) : "",
  );
  const [plannedDate, setPlannedDate] = useState(
    construction.plannedDate ? construction.plannedDate.slice(0, 10) : "",
  );
  const [completedDate, setCompletedDate] = useState(
    construction.completedDate ? construction.completedDate.slice(0, 10) : "",
  );
  const [note, setNote] = useState(construction.note ?? "");
  const [editPending, startEdit] = useTransition();
  const [statusPending, startStatus] = useTransition();

  const allowedTransitions =
    VALID_CONSTRUCTION_TRANSITIONS[construction.status] ?? [];

  function handleUpdate() {
    startEdit(async () => {
      try {
        const result = await updateConstructionAction({
          id: construction.id,
          installerId: installerId || null,
          fee,
          surveyDate: surveyDate || null,
          plannedDate: plannedDate || null,
          completedDate: completedDate || null,
          note: note || null,
        });
        onUpdate(result);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : c.unknownError);
      }
    });
  }

  function handleStatusChange(newStatus: ConstructionStatus) {
    startStatus(async () => {
      try {
        const result = await changeConstructionStatusAction({
          id: construction.id,
          status: newStatus,
        });
        onStatusChange(result);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : c.unknownError);
      }
    });
  }

  const isDisabled = editPending || statusPending || isPending;

  return (
    <div className="border-border rounded-md border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">
          {t.statuses[construction.status as keyof typeof t.statuses]}
        </span>
        <span className="text-xs text-muted-foreground">
          {t.fields.updatedAt}:{" "}
          {new Date(construction.updatedAt).toLocaleString("ja-JP")}
        </span>
      </div>

      {/* Status transitions */}
      {allowedTransitions.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{t.sections.statusChange}</p>
          <div className="flex gap-2 flex-wrap">
            {allowedTransitions.map((next) => (
              <Button
                key={next}
                variant="outline"
                size="sm"
                disabled={isDisabled}
                onClick={() => handleStatusChange(next as ConstructionStatus)}
              >
                {statusPending
                  ? t.actions.changing
                  : `→ ${t.statuses[next as keyof typeof t.statuses]}`}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Edit fields */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t.fields.installer}</label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={installerId}
            onChange={(e) => setInstallerId(e.target.value)}
            disabled={isDisabled}
          >
            <option value="">{c.notSet}</option>
            {installers.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t.fields.fee}</label>
          <input
            type="text"
            inputMode="numeric"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            disabled={isDisabled}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t.fields.surveyDate}</label>
          <input
            type="date"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={surveyDate}
            onChange={(e) => setSurveyDate(e.target.value)}
            disabled={isDisabled}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t.fields.plannedDate}</label>
          <input
            type="date"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
            disabled={isDisabled}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t.fields.completedDate}</label>
          <input
            type="date"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={completedDate}
            onChange={(e) => setCompletedDate(e.target.value)}
            disabled={isDisabled}
          />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label className="text-sm text-muted-foreground">{t.fields.note}</label>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isDisabled}
          />
        </div>
      </div>

      <Button onClick={handleUpdate} disabled={isDisabled} size="sm" variant="outline">
        {editPending ? t.actions.saving : t.actions.save}
      </Button>
    </div>
  );
}
