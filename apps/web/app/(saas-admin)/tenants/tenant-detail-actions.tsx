"use client";

// S-015 詳細画面の操作ボタン群 (T-02-08): 招待再発行 + ステータス切替。
// `useTransition` で楽観的 disabling、`router.refresh()` でサーバー側ローダを
// 再評価。

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { resendInvitationAction, updateTenantStatusAction } from "./actions";

import type { TenantStatusValue } from "@solar/contracts";

export interface TenantDetailActionsProps {
  tenantId: string;
  status: TenantStatusValue;
  canResendInvitation: boolean;
}

export function TenantDetailActions({
  tenantId,
  status,
  canResendInvitation,
}: TenantDetailActionsProps) {
  const router = useRouter();
  const t = labels.saasAdminTenant;
  const c = labels.common;

  const [error, setError] = useState<string | null>(null);
  const [resending, startResend] = useTransition();
  const [updating, startUpdate] = useTransition();

  function onResend() {
    if (!canResendInvitation) return;
    setError(null);
    startResend(async () => {
      try {
        await resendInvitationAction({ tenantId });
        toast.success(t.invitation.resendSuccess);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setError(message);
      }
    });
  }

  function onToggleStatus() {
    const next: TenantStatusValue = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const confirmMessage =
      next === "SUSPENDED" ? t.lifecycle.suspendConfirm : t.lifecycle.activateConfirm;
    if (!window.confirm(confirmMessage)) return;
    setError(null);
    startUpdate(async () => {
      try {
        await updateTenantStatusAction({ tenantId, status: next });
        toast.success(next === "SUSPENDED" ? t.lifecycle.suspended : t.lifecycle.activated);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : c.unknownError;
        setError(message);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={!canResendInvitation || resending}
          onClick={onResend}
        >
          {resending ? t.invitation.resending : t.invitation.resend}
        </Button>
        {!canResendInvitation ? (
          <span className="text-muted-foreground text-xs">{t.invitation.resendUnavailable}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={status === "ACTIVE" ? "destructive" : "default"}
          disabled={updating}
          onClick={onToggleStatus}
        >
          {status === "ACTIVE" ? t.lifecycle.suspend : t.lifecycle.activate}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}
