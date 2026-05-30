"use client";

// Invite member dialog for wholesaler admin (F-006).
// Renders a shadcn Dialog with email + role picker, then calls
// inviteWholesalerMemberAction on submit.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labels } from "@/lib/i18n/labels";

import { inviteWholesalerMemberAction } from "./actions";

const WHOLESALER_ROLES = [
  "WHOLESALER_ADMIN",
  "WHOLESALER_EVENT_TEAM",
  "WHOLESALER_CALL_TEAM",
  "WHOLESALER_DIRECT_SALES",
  "WHOLESALER_FIELD_STAFF",
] as const;

type WholesalerRole = (typeof WHOLESALER_ROLES)[number];

export function InviteMemberDialog() {
  const t = labels.memberManagement;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WholesalerRole>("WHOLESALER_EVENT_TEAM");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError(t.errors.emailRequired);
      return;
    }
    setSubmitting(true);
    try {
      await inviteWholesalerMemberAction({ email: email.trim(), role });
      toast.success(t.feedback.invited);
      setOpen(false);
      setEmail("");
      setRole("WHOLESALER_EVENT_TEAM");
      router.refresh();
    } catch {
      toast.error(labels.common.unknownError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t.inviteButton}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.inviteDialogTitle}</DialogTitle>
          <DialogDescription>{t.inviteDialogDescription}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="invite-email">{t.fields.inviteEmail}</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-role">{t.fields.inviteRole}</Label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as WholesalerRole)}
              className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              {WHOLESALER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t.wholesalerRoles[r]}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? t.actions.inviting : t.actions.invite}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
