"use client";

// Inline scope editor + suspend/resume button for a single Relationship row.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { updateRelationshipAction } from "./actions";
import type { RelationshipListItem } from "./data";

type DealerScope = RelationshipListItem["defaultScope"];
type RelationshipStatus = RelationshipListItem["status"];

const SCOPES: DealerScope[] = ["APPOINTMENT_ONLY", "FIRST_VISIT", "FULL_CLOSING"];

interface Props {
  id: string;
  defaultScope: DealerScope;
  status: RelationshipStatus;
}

export function RelationshipRowActions({ id, defaultScope, status }: Props) {
  const t = labels.relationshipManagement;
  const router = useRouter();
  const [editingScope, setEditingScope] = useState(false);
  const [scope, setScope] = useState<DealerScope>(defaultScope);
  const [savingScope, setSavingScope] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  async function handleSaveScope() {
    setSavingScope(true);
    try {
      await updateRelationshipAction({ id, defaultScope: scope });
      toast.success(t.feedback.scopeUpdated);
      setEditingScope(false);
      router.refresh();
    } catch {
      toast.error(labels.common.unknownError);
    } finally {
      setSavingScope(false);
    }
  }

  async function handleToggleStatus() {
    setUpdatingStatus(true);
    const newStatus: RelationshipStatus = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    try {
      await updateRelationshipAction({ id, status: newStatus });
      toast.success(newStatus === "SUSPENDED" ? t.feedback.suspended : t.feedback.resumed);
      router.refresh();
    } catch {
      toast.error(labels.common.unknownError);
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {editingScope ? (
        <>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as DealerScope)}
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {t.scopes[s]}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={handleSaveScope} disabled={savingScope}>
            {savingScope ? t.actions.savingScope : t.actions.saveScope}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditingScope(false);
              setScope(defaultScope);
            }}
          >
            {labels.common.cancel}
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setEditingScope(true)}>
          {t.actions.editScope}
        </Button>
      )}
      <Button
        size="sm"
        variant={status === "ACTIVE" ? "destructive" : "outline"}
        onClick={handleToggleStatus}
        disabled={updatingStatus}
      >
        {updatingStatus
          ? status === "ACTIVE"
            ? t.actions.suspending
            : t.actions.resuming
          : status === "ACTIVE"
            ? t.actions.suspend
            : t.actions.resume}
      </Button>
    </div>
  );
}
