// S-057 — 現場フォーム: アポ顧客登録 ページ (T-04-11 / F-031 / F-033 / docs/04 §1.4).
//
// /field/quick-appointment へのスタンドアロン遷移パス。
// ダッシュボード (S-053) の Sheet ボタン経由が主経路だが、直接 URL アクセスも想定。
// sourceEventId は URL クエリパラメータ `event` から受け取る。未指定の場合は
// 今日のシフトから最初のイベント ID を自動解決する。

import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { labels } from "@/lib/i18n/labels";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import { quickAppointmentAction } from "./actions";
import { QuickAppointmentForm } from "./quick-appointment-form";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function resolveEventId(userId: string, eventParam: string | undefined): Promise<string | null> {
  if (eventParam && typeof eventParam === "string" && eventParam.trim()) {
    return eventParam.trim();
  }

  // Resolve from today's shift
  const session = await auth();
  if (!session?.user) return null;
  const ctx = await getTenantContext();

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  const shift = await withTenant(ctx, (tx) =>
    tx.eventShift.findFirst({
      where: {
        userId,
        startPlanned: { gte: todayStart, lte: todayEnd },
      },
      select: { eventId: true },
      orderBy: { startPlanned: "asc" },
    }),
  );

  return shift?.eventId ?? null;
}

export default async function QuickAppointmentPage({ searchParams }: PageProps) {
  const l = labels.fieldQuickAppointment;
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const params = await searchParams;
  const eventParam = typeof params.event === "string" ? params.event : undefined;

  let eventId: string | null = null;
  try {
    eventId = await resolveEventId(session.user.id, eventParam);
  } catch (_err) {
    // If TenantContext fails (e.g. unauthenticated), fall through with null.
  }

  if (!eventId) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">{l.sheetTitle}</h1>
        <p className="text-muted-foreground text-sm">{l.noEventToday}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">{l.sheetTitle}</h1>
      <QuickAppointmentForm
        sourceEventId={eventId}
        onSubmitAction={quickAppointmentAction}
      />
    </div>
  );
}
