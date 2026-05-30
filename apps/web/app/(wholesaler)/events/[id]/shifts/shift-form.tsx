"use client";

// ShiftFormDialog — Client Component for S-028 shift add/edit (T-03-10).
//
// Renders a shadcn Dialog with fields: user select, role select, start/end
// datetime-local inputs. Calls `assignShiftAction` on create and
// `updateShiftAction` on edit.

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { assignShiftAction, unassignShiftAction, updateShiftAction } from "./actions";

import type { AssignableUser, ShiftRow } from "./data";

interface AddProps {
  mode: "add";
  eventId: string;
  assignableUsers: AssignableUser[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface EditProps {
  mode: "edit";
  eventId: string;
  shift: ShiftRow;
  assignableUsers: AssignableUser[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Props = AddProps | EditProps;

const SHIFT_ROLES = ["LEAD", "CATCH", "RECEPTION", "PITCH", "OTHER"] as const;

function isoToLocal(iso: string): string {
  // Convert ISO string to the value format needed by datetime-local input.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ShiftFormDialog(props: Props) {
  const t = labels.eventShift;
  const isEdit = props.mode === "edit";

  const [userId, setUserId] = useState(isEdit ? props.shift.userId : "");
  const [role, setRole] = useState<string>(isEdit ? props.shift.role : "");
  const [startPlanned, setStartPlanned] = useState(
    isEdit ? isoToLocal(props.shift.startPlanned) : "",
  );
  const [endPlanned, setEndPlanned] = useState(
    isEdit ? isoToLocal(props.shift.endPlanned) : "",
  );
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function validate(): string | null {
    if (!isEdit && !userId) return t.errors.userRequired;
    if (!role) return t.errors.roleRequired;
    if (!startPlanned) return t.errors.startRequired;
    if (!endPlanned) return t.errors.endRequired;
    if (startPlanned >= endPlanned) return t.errors.endBeforeStart;
    return null;
  }

  function handleSave() {
    const err = validate();
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);
    setServerError(null);

    startTransition(async () => {
      try {
        if (isEdit) {
          await updateShiftAction({
            shiftId: props.shift.id,
            role: role as (typeof SHIFT_ROLES)[number],
            startPlanned: new Date(startPlanned).toISOString(),
            endPlanned: new Date(endPlanned).toISOString(),
          });
        } else {
          await assignShiftAction({
            eventId: props.eventId,
            userId,
            role: role as (typeof SHIFT_ROLES)[number],
            startPlanned: new Date(startPlanned).toISOString(),
            endPlanned: new Date(endPlanned).toISOString(),
          });
        }
        props.onOpenChange(false);
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : labels.common.unknownError;
        setServerError(message);
      }
    });
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{isEdit ? t.editDialog.title : t.addDialog.title}</DialogTitle>
        <div className="space-y-4 mt-2">
          {/* User select — fixed on edit */}
          {!isEdit ? (
            <div className="space-y-1">
              <Label htmlFor="shift-user-select">{t.fields.user}</Label>
              <select
                id="shift-user-select"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="border-input bg-background text-sm rounded-md border w-full px-3 py-2"
              >
                <option value="">{t.placeholders.selectDefault}</option>
                {props.assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t.fields.user}</p>
              <p className="text-sm font-medium">{props.shift.userName}</p>
            </div>
          )}

          {/* Role */}
          <div className="space-y-1">
            <Label htmlFor="shift-role-select">{t.fields.role}</Label>
            <select
              id="shift-role-select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="border-input bg-background text-sm rounded-md border w-full px-3 py-2"
            >
              <option value="">{t.placeholders.selectDefault}</option>
              {SHIFT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t.roles[r]}
                </option>
              ))}
            </select>
          </div>

          {/* Start / End datetime */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="shift-start">{t.fields.startPlanned}</Label>
              <Input
                id="shift-start"
                type="datetime-local"
                value={startPlanned}
                onChange={(e) => setStartPlanned(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shift-end">{t.fields.endPlanned}</Label>
              <Input
                id="shift-end"
                type="datetime-local"
                value={endPlanned}
                onChange={(e) => setEndPlanned(e.target.value)}
              />
            </div>
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

          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => props.onOpenChange(false)}>
              {labels.common.cancel}
            </Button>
            <Button type="button" disabled={pending} onClick={handleSave}>
              {pending ? t.actions.saving : t.actions.save}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Unassign button with inline confirmation.
export function UnassignShiftButton({ shiftId }: { shiftId: string }) {
  const t = labels.eventShift;
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm(t.actions.unassignConfirm)) return;
    setServerError(null);
    startTransition(async () => {
      try {
        await unassignShiftAction({ shiftId });
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : labels.common.unknownError;
        setServerError(message);
      }
    });
  }

  return (
    <span>
      <Button
        variant="destructive"
        size="sm"
        type="button"
        disabled={pending}
        onClick={handleClick}
      >
        {t.actions.unassign}
      </Button>
      {serverError ? (
        <p className="text-destructive text-xs mt-1" role="alert">
          {serverError}
        </p>
      ) : null}
    </span>
  );
}

// Edit button that opens the edit dialog.
export function EditShiftButton({
  shift,
  eventId,
  assignableUsers,
}: {
  shift: ShiftRow;
  eventId: string;
  assignableUsers: AssignableUser[];
}) {
  const t = labels.eventShift;
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" type="button" onClick={() => setOpen(true)}>
        {t.actions.edit}
      </Button>
      <ShiftFormDialog
        mode="edit"
        eventId={eventId}
        shift={shift}
        assignableUsers={assignableUsers}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

// Add button that opens the add dialog.
export function AddShiftButton({
  eventId,
  assignableUsers,
}: {
  eventId: string;
  assignableUsers: AssignableUser[];
}) {
  const t = labels.eventShift;
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t.actions.add}
      </Button>
      <ShiftFormDialog
        mode="add"
        eventId={eventId}
        assignableUsers={assignableUsers}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
