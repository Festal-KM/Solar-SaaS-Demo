"use client";

// ApplicationForm — client component for S-047 補助金申請管理 (T-05-11 / F-045).
//
// Panels:
//   1. New application registration (create).
//   2. For each existing application: metadata update + status change.

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";
import type { ApplicationStatus } from "@solar/db";
import { VALID_APPLICATION_TRANSITIONS } from "@solar/contracts";

import {
  createApplicationAction,
  updateApplicationAction,
  changeApplicationStatusAction,
  type ApplicationResult,
} from "./actions";

interface ApplicationRow {
  id: string;
  status: ApplicationStatus;
  type: string;
  agency: string | null;
  plannedDate: string | null;
  submittedDate: string | null;
  approvedDate: string | null;
  estimatedAmount: string | null;
  confirmedAmount: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  contractId: string;
  applications: ApplicationRow[];
}

export function ApplicationForm({ contractId, applications: initial }: Props) {
  const t = labels.application;
  const c = labels.common;

  const [applications, setApplications] = useState<ApplicationRow[]>(initial);
  const [isPending, startTransition] = useTransition();

  // ----- Create form state -----
  const [createType, setCreateType] = useState("");
  const [createAgency, setCreateAgency] = useState("");
  const [createPlannedDate, setCreatePlannedDate] = useState("");
  const [createEstimatedAmount, setCreateEstimatedAmount] = useState("");
  const [createNote, setCreateNote] = useState("");

  function applyResult(result: ApplicationResult) {
    setApplications((prev) => {
      const idx = prev.findIndex((a) => a.id === result.id);
      const row: ApplicationRow = result;
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
        const result = await createApplicationAction({
          contractId,
          type: createType,
          agency: createAgency || undefined,
          plannedDate: createPlannedDate || undefined,
          estimatedAmount: createEstimatedAmount || undefined,
          note: createNote || undefined,
        });
        applyResult(result);
        setCreateType("");
        setCreateAgency("");
        setCreatePlannedDate("");
        setCreateEstimatedAmount("");
        setCreateNote("");
        toast.success(t.feedback.created);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : c.unknownError);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* ---- Per-application edit panels ---- */}
      {applications.map((app) => (
        <ApplicationEditPanel
          key={app.id}
          application={app}
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

      {/* ---- Create new application ---- */}
      <div className="border-border rounded-md border p-4 space-y-4">
        <h2 className="font-medium">{t.new}</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <label className="text-sm text-muted-foreground">
              {t.fields.type}
              <span className="text-destructive ml-1">*</span>
            </label>
            <input
              type="text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={createType}
              onChange={(e) => setCreateType(e.target.value)}
              disabled={isPending}
              placeholder={t.placeholders.type}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">{t.fields.agency}</label>
            <input
              type="text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={createAgency}
              onChange={(e) => setCreateAgency(e.target.value)}
              disabled={isPending}
              placeholder={t.placeholders.agency}
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

          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">{t.fields.estimatedAmount}</label>
            <input
              type="text"
              inputMode="numeric"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={createEstimatedAmount}
              onChange={(e) => setCreateEstimatedAmount(e.target.value)}
              disabled={isPending}
              placeholder="0"
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

        <Button onClick={handleCreate} disabled={isPending || !createType} size="sm">
          {isPending ? t.actions.creating : t.actions.create}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-application edit + status-change panel
// ---------------------------------------------------------------------------

function ApplicationEditPanel({
  application,
  isPending,
  onUpdate,
  onStatusChange,
}: {
  application: ApplicationRow;
  isPending: boolean;
  onUpdate: (result: ApplicationResult) => void;
  onStatusChange: (result: ApplicationResult) => void;
}) {
  const t = labels.application;
  const c = labels.common;

  const [type, setType] = useState(application.type);
  const [agency, setAgency] = useState(application.agency ?? "");
  const [plannedDate, setPlannedDate] = useState(
    application.plannedDate ? application.plannedDate.slice(0, 10) : "",
  );
  const [submittedDate, setSubmittedDate] = useState(
    application.submittedDate ? application.submittedDate.slice(0, 10) : "",
  );
  const [approvedDate, setApprovedDate] = useState(
    application.approvedDate ? application.approvedDate.slice(0, 10) : "",
  );
  const [estimatedAmount, setEstimatedAmount] = useState(application.estimatedAmount ?? "");
  const [confirmedAmount, setConfirmedAmount] = useState(application.confirmedAmount ?? "");
  const [note, setNote] = useState(application.note ?? "");
  const [editPending, startEdit] = useTransition();
  const [statusPending, startStatus] = useTransition();

  const allowedTransitions = VALID_APPLICATION_TRANSITIONS[application.status] ?? [];

  function handleUpdate() {
    startEdit(async () => {
      try {
        const result = await updateApplicationAction({
          id: application.id,
          type: type || undefined,
          agency: agency || null,
          plannedDate: plannedDate || null,
          submittedDate: submittedDate || null,
          approvedDate: approvedDate || null,
          estimatedAmount: estimatedAmount || null,
          confirmedAmount: confirmedAmount || null,
          note: note || null,
        });
        onUpdate(result);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : c.unknownError);
      }
    });
  }

  function handleStatusChange(newStatus: ApplicationStatus) {
    if (newStatus === "APPROVED" && !confirmedAmount) {
      toast.error(t.errors.confirmedAmountRequired);
      return;
    }
    startStatus(async () => {
      try {
        const result = await changeApplicationStatusAction({
          id: application.id,
          status: newStatus,
          confirmedAmount:
            newStatus === "APPROVED" ? (confirmedAmount || undefined) : undefined,
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
          {t.statuses[application.status as keyof typeof t.statuses]}
        </span>
        <span className="text-xs text-muted-foreground">
          {t.fields.updatedAt}:{" "}
          {new Date(application.updatedAt).toLocaleString("ja-JP")}
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
                onClick={() => handleStatusChange(next as ApplicationStatus)}
              >
                {statusPending
                  ? t.actions.changing
                  : `→ ${t.statuses[next as keyof typeof t.statuses]}`}
              </Button>
            ))}
          </div>
          {allowedTransitions.includes("APPROVED") && (
            <p className="text-xs text-muted-foreground">{t.errors.confirmedAmountRequired}</p>
          )}
        </div>
      )}

      {/* Edit fields */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <label className="text-sm text-muted-foreground">{t.fields.type}</label>
          <input
            type="text"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value)}
            disabled={isDisabled}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t.fields.agency}</label>
          <input
            type="text"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={agency}
            onChange={(e) => setAgency(e.target.value)}
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
          <label className="text-sm text-muted-foreground">{t.fields.submittedDate}</label>
          <input
            type="date"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={submittedDate}
            onChange={(e) => setSubmittedDate(e.target.value)}
            disabled={isDisabled}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t.fields.approvedDate}</label>
          <input
            type="date"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={approvedDate}
            onChange={(e) => setApprovedDate(e.target.value)}
            disabled={isDisabled}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t.fields.estimatedAmount}</label>
          <input
            type="text"
            inputMode="numeric"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={estimatedAmount}
            onChange={(e) => setEstimatedAmount(e.target.value)}
            disabled={isDisabled}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">{t.fields.confirmedAmount}</label>
          <input
            type="text"
            inputMode="numeric"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={confirmedAmount}
            onChange={(e) => setConfirmedAmount(e.target.value)}
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
