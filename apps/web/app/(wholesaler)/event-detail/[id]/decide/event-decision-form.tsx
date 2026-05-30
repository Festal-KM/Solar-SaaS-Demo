"use client";

// EventDecisionForm — Client Component for S-027 (T-03-08 / F-023).
//
// Renders a mode RadioGroup with dynamic sub-fields per mode:
//   SELF      — requiredPeople NumberInput
//   DEALER    — dealerRelationshipIds MultiSelect
//   JOINT     — requiredPeople + dealerRelationshipIds
//   CANCELLED — reason Textarea
//
// On submit, calls `decideAndRedirectAction` which either redirects to
// /events/<id>/shifts (non-CANCELLED) or /events (CANCELLED).

import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { decideAndRedirectAction } from "./actions";

import type { RelationshipOption } from "./data";
import type { EventMode } from "@solar/contracts";

interface Props {
  eventCandidateId: string;
  relationships: RelationshipOption[];
}

const MODES: EventMode[] = ["SELF", "DEALER", "JOINT", "CANCELLED"];

export function EventDecisionForm({ eventCandidateId, relationships }: Props) {
  const t = labels.eventDecision;
  const [mode, setMode] = useState<EventMode>("SELF");
  const [requiredPeople, setRequiredPeople] = useState<string>("");
  const [selectedRelIds, setSelectedRelIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset client-side error when mode changes.
  useEffect(() => {
    setClientError(null);
  }, [mode]);

  // Toggle a relationship selection.
  function toggleRel(id: string) {
    setSelectedRelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function validate(): string | null {
    if (
      (mode === "SELF" || mode === "JOINT") &&
      (!requiredPeople || parseInt(requiredPeople, 10) < 1)
    ) {
      return t.errors.requiredPeopleRequired;
    }
    if ((mode === "DEALER" || mode === "JOINT") && selectedRelIds.size === 0) {
      return t.errors.dealerRequired;
    }
    if (mode === "CANCELLED" && !reason.trim()) {
      return t.errors.reasonRequired;
    }
    return null;
  }

  function handleSubmitClick() {
    const err = validate();
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);
    setConfirmOpen(true);
  }

  function handleConfirm() {
    setConfirmOpen(false);
    setServerError(null);
    startTransition(async () => {
      try {
        await decideAndRedirectAction({
          eventCandidateId,
          mode,
          requiredPeople:
            requiredPeople !== "" ? parseInt(requiredPeople, 10) : undefined,
          dealerRelationshipIds:
            selectedRelIds.size > 0 ? Array.from(selectedRelIds) : undefined,
          reason: reason.trim() || undefined,
          note: note.trim() || undefined,
        });
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : labels.common.unknownError;
        setServerError(message);
      }
    });
  }

  const confirmMessage =
    mode === "CANCELLED" ? t.actions.confirmCancelled : t.actions.confirmDescription;

  return (
    <>
      <div className="space-y-6">
        {/* Mode selection */}
        <fieldset className="space-y-3">
          <legend className="text-base font-medium">{t.fields.mode}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MODES.map((m) => (
              <label
                key={m}
                className={[
                  "border rounded-md p-3 cursor-pointer transition-colors",
                  mode === m
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="sr-only"
                />
                <p className="font-medium text-sm">{t.modes[m]}</p>
                <p className="text-muted-foreground text-xs mt-1">{t.modeDescriptions[m]}</p>
              </label>
            ))}
          </div>
        </fieldset>

        {/* SELF / JOINT: requiredPeople */}
        {mode === "SELF" || mode === "JOINT" ? (
          <div className="space-y-1 max-w-xs">
            <Label htmlFor="requiredPeople-input">{t.fields.requiredPeople}</Label>
            <Input
              id="requiredPeople-input"
              type="number"
              min={1}
              value={requiredPeople}
              onChange={(e) => setRequiredPeople(e.target.value)}
              placeholder={t.placeholders.requiredPeople}
            />
          </div>
        ) : null}

        {/* DEALER / JOINT: dealerRelationshipIds */}
        {mode === "DEALER" || mode === "JOINT" ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t.fields.dealerRelationshipIds}</legend>
            {relationships.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {labels.eventCandidate.visibility.noRelationships}
              </p>
            ) : (
              <div className="border-border divide-border overflow-hidden rounded-md border divide-y">
                {relationships.map((r) => (
                  <label
                    key={r.relationshipId}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRelIds.has(r.relationshipId)}
                      onChange={() => toggleRel(r.relationshipId)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <span className="text-sm">{r.dealerName}</span>
                    {r.hasPreference ? (
                      <span className="ml-auto text-xs text-primary border border-primary/30 rounded px-1">
                        {t.preferenceStatus.submitted}
                      </span>
                    ) : (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {t.preferenceStatus.notSubmitted}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        ) : null}

        {/* CANCELLED: reason */}
        {mode === "CANCELLED" ? (
          <div className="space-y-1">
            <Label htmlFor="reason-input">{t.fields.reason}</Label>
            <textarea
              id="reason-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t.placeholders.reason}
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-muted-foreground text-xs">{t.hints.cancelledNoEvent}</p>
          </div>
        ) : null}

        {/* Note — all modes, optional */}
        <div className="space-y-1">
          <Label htmlFor="note-input">
            {t.fields.note}
            <span className="text-muted-foreground ml-1 text-xs">{labels.common.optional}</span>
          </Label>
          <textarea
            id="note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {clientError ? (
          <p className="text-destructive text-sm" role="alert">
            {clientError}
          </p>
        ) : null}
        {serverError ? (
          <p className="text-destructive text-sm font-medium" role="alert">
            {serverError}
          </p>
        ) : null}

        <Button
          type="button"
          onClick={handleSubmitClick}
          disabled={pending}
          variant={mode === "CANCELLED" ? "destructive" : "default"}
        >
          {pending ? t.actions.submitting : t.actions.submit}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>{t.actions.confirmTitle}</DialogTitle>
          <p className="text-muted-foreground text-sm">{confirmMessage}</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t.actions.cancelAction}
            </Button>
            <Button
              variant={mode === "CANCELLED" ? "destructive" : "default"}
              disabled={pending}
              onClick={handleConfirm}
            >
              {pending ? t.actions.submitting : t.actions.confirm}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
