"use client";

// Invite member dialog for dealer admin (F-008).

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

import { inviteDealerMemberAction } from "./actions";

const DEALER_ROLES = ["DEALER_ADMIN", "DEALER_STAFF"] as const;
type DealerRole = (typeof DEALER_ROLES)[number];

export function InviteDealerMemberDialog() {
  const t = labels.memberManagement;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DealerRole>("DEALER_STAFF");
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
      await inviteDealerMemberAction({ email: email.trim(), role });
      toast.success(t.feedback.invited);
      setOpen(false);
      setEmail("");
      setRole("DEALER_STAFF");
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
            <Label htmlFor="invite-dealer-email">{t.fields.inviteEmail}</Label>
            <Input
              id="invite-dealer-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-dealer-role">{t.fields.inviteRole}</Label>
            <select
              id="invite-dealer-role"
              value={role}
              onChange={(e) => setRole(e.target.value as DealerRole)}
              className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              {DEALER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t.dealerRoles[r]}
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
