// S-053 — 現場要員ダッシュボード (T-03-11 / T-04-11 / F-026 / docs/04 §1.4).
//
// `wholesaler_field_staff` 向けのスマホ優先ホーム画面。
// - 今日のシフト一覧カード（最上段固定）
// - 今日のイベントへのクイック報告リンク（START/END ショートカット）
// - クイックアポ登録ボタン（Sheet ベース）
// - 今週の残シフト

import "server-only";

import Link from "next/link";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { auth } from "@/auth";
import { labels } from "@/lib/i18n/labels";
import { getTenantContext } from "@/lib/tenancy/context";
import { withTenant } from "@/lib/tenancy/with-tenant";

import { quickAppointmentAction } from "./quick-appointment/actions";
import { QuickAppointmentForm } from "./quick-appointment/quick-appointment-form";
import { fetchMyShifts } from "./shifts/data";
import { ShiftCard, thisWeekRange, todayIso } from "./shifts/_components/shift-card";

async function TodayShifts() {
  const l = labels.fieldShift;
  const lq = labels.fieldQuickAppointment;
  const today = todayIso();
  const { shifts } = await fetchMyShifts({ from: today, to: today });

  return (
    <section>
      <h2 className="text-base font-semibold mb-3">{l.todaySection}</h2>
      {shifts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{l.noShiftsToday}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {shifts.map((s) => (
            <div key={s.id} className="flex flex-col gap-2">
              <ShiftCard shift={s} isToday />
              {/* Quick report shortcut links for today's event */}
              <div className="flex gap-2 pl-1">
                <Button asChild variant="outline" size="sm" className="text-xs">
                  <Link href={`/events/${s.eventId}?report=start`}>
                    {lq.reportLinks.startReport}
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="text-xs">
                  <Link href={`/events/${s.eventId}?report=end`}>
                    {lq.reportLinks.endReport}
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

async function ThisWeekShifts() {
  const l = labels.fieldShift;
  const { from, to } = thisWeekRange();
  const today = todayIso();
  const { shifts } = await fetchMyShifts({ from, to });
  // 当日分は上段に出しているので省く。
  const nonTodayShifts = shifts.filter(
    (s) => new Date(s.startPlanned).toISOString().slice(0, 10) !== today,
  );

  if (nonTodayShifts.length === 0) return null;

  return (
    <section>
      <h2 className="text-base font-semibold mb-3">{l.thisWeekSection}</h2>
      <div className="flex flex-col gap-3">
        {nonTodayShifts.map((s) => (
          <ShiftCard key={s.id} shift={s} isToday={false} />
        ))}
      </div>
    </section>
  );
}

async function TodayEventId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user) return null;
  const ctx = await getTenantContext();
  const today = todayIso();
  const todayStart = new Date(`${today}T00:00:00Z`);
  const todayEnd = new Date(`${today}T23:59:59.999Z`);

  const shift = await withTenant(ctx, (tx) =>
    tx.eventShift.findFirst({
      where: {
        userId: ctx.actorUserId,
        startPlanned: { gte: todayStart, lte: todayEnd },
      },
      select: { eventId: true },
      orderBy: { startPlanned: "asc" },
    }),
  );

  return shift?.eventId ?? null;
}

async function QuickAppointmentSection() {
  const l = labels.fieldQuickAppointment;
  const eventId = await TodayEventId();

  if (!eventId) {
    return (
      <section>
        <p className="text-muted-foreground text-sm">{l.noEventToday}</p>
      </section>
    );
  }

  return (
    <section>
      <QuickAppointmentForm sourceEventId={eventId} onSubmitAction={quickAppointmentAction} />
    </section>
  );
}

export default function FieldDashboardPage() {
  const l = labels.fieldShift;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold">{l.dashboardTitle}</h1>
        <p className="text-muted-foreground text-sm mt-1">{l.dashboardSubtitle}</p>
      </div>
      <Suspense
        fallback={<p className="text-sm text-muted-foreground">{l.loading}</p>}
      >
        <TodayShifts />
      </Suspense>
      <Suspense fallback={null}>
        <QuickAppointmentSection />
      </Suspense>
      <Suspense fallback={null}>
        <ThisWeekShifts />
      </Suspense>
    </div>
  );
}
