"use client";

// Acknowledge button for a single pre-call notification row.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { acknowledgePreCallNotificationAction } from "./actions";

interface Props {
  notificationId: string;
}

export function AcknowledgeButton({ notificationId }: Props) {
  const t = labels.dealerPreCallNotification;
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await acknowledgePreCallNotificationAction({ notificationId });
      toast.success(t.feedback.acknowledged);
      router.refresh();
    } catch {
      toast.error(labels.common.unknownError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="sm" onClick={handleClick} disabled={loading}>
      {loading ? t.actions.acknowledging : t.actions.acknowledge}
    </Button>
  );
}
