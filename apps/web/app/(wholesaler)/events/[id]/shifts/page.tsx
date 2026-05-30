// S-028 — 自社要員シフト割当 (T-03-10 / F-025 / docs/04 §1.3 S-028).
//
// 卸業者本部 (wholesaler_admin / wholesaler_event_team) 専用。
// - イベント情報ヘッダー (店舗名 / 日程 / 開催体制 / 必要人数)
// - 必要人数充足バッジ (current/required — 未達は destructive)
// - シフト一覧テーブル (担当者 / 役割 / 開始-終了 / 状態 / 操作)
// - シフト追加ボタン → Dialog (AddShiftButton)
// - 編集 / 削除ボタン (EditShiftButton / UnassignShiftButton)

import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { labels } from "@/lib/i18n/labels";

import { getShiftPageData } from "./data";
import { AddShiftButton, EditShiftButton, UnassignShiftButton } from "./shift-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EventShiftsPage({ params }: PageProps) {
  const { id } = await params;

  let data;
  try {
    data = await getShiftPageData(id);
  } catch {
    notFound();
  }

  const { event, shifts, assignableUsers } = data;
  const t = labels.eventShift;
  const ec = labels.eventCandidate;
  const ed = labels.eventDecision;

  const currentCount = shifts.length;
  const requiredPeople = event.requiredPeople;
  const isFulfilled = requiredPeople === null || currentCount >= requiredPeople;

  const bc = labels.breadcrumb.items;

  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: bc.events, href: "/events" },
          { label: bc.eventDetail, href: `/events/${id}` },
          { label: bc.eventShifts },
        ]}
      />
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground text-sm">{t.subtitle}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/events/${id}`}>{t.backToEvent}</Link>
        </Button>
      </div>

      {/* Event info header */}
      <section
        aria-label={t.eventInfo}
        className="border-border bg-muted/20 grid grid-cols-1 gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <p className="text-muted-foreground text-xs">{ec.fields.storeName}</p>
          <p className="text-lg font-semibold">{event.eventCandidate.storeName}</p>
          {event.eventCandidate.area ? (
            <p className="text-muted-foreground text-xs">{event.eventCandidate.area}</p>
          ) : null}
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{ec.fields.targetMonth}</p>
          <p className="font-medium">{event.eventCandidate.targetMonth}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{ec.fields.scheduledDate}</p>
          <p className="text-sm">
            {new Date(event.eventCandidate.scheduledDate).toLocaleDateString("ja-JP")}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{ed.fields.mode}</p>
          <p className="text-sm font-medium">
            {ed.modes[event.mode as keyof typeof ed.modes] ?? event.mode}
          </p>
        </div>
      </section>

      {/* Staffing badge */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">{t.staffCount.label}</span>
        {requiredPeople === null ? (
          <Badge variant="secondary">{t.staffCount.noRequirement}</Badge>
        ) : isFulfilled ? (
          <Badge variant="default">
            {t.staffCount.badge
              .replace("{current}", String(currentCount))
              .replace("{required}", String(requiredPeople))}{" "}
            — {t.staffCount.fulfilled}
          </Badge>
        ) : (
          <Badge variant="destructive">
            {t.staffCount.badge
              .replace("{current}", String(currentCount))
              .replace("{required}", String(requiredPeople))}{" "}
            — {t.staffCount.insufficient}
          </Badge>
        )}
      </div>

      {/* Shift table */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">{t.title}</h2>
          <AddShiftButton eventId={event.id} assignableUsers={assignableUsers} />
        </div>

        {shifts.length === 0 ? (
          <div className="border-border rounded-md border p-8 text-center">
            <p className="text-muted-foreground text-sm">{t.table.empty}</p>
          </div>
        ) : (
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">{t.table.columns.user}</th>
                  <th className="px-4 py-2 text-left font-medium">{t.table.columns.role}</th>
                  <th className="px-4 py-2 text-left font-medium">
                    {t.table.columns.startPlanned}
                  </th>
                  <th className="px-4 py-2 text-left font-medium">{t.table.columns.endPlanned}</th>
                  <th className="px-4 py-2 text-left font-medium">{t.table.columns.status}</th>
                  <th className="px-4 py-2 text-left font-medium">{t.table.columns.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {shifts.map((shift) => (
                  <tr key={shift.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">{shift.userName}</td>
                    <td className="px-4 py-2">
                      {t.roles[shift.role as keyof typeof t.roles] ?? shift.role}
                    </td>
                    <td className="px-4 py-2">
                      {new Date(shift.startPlanned).toLocaleString("ja-JP", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-2">
                      {new Date(shift.endPlanned).toLocaleString("ja-JP", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={shift.status === "ASSIGNED" ? "secondary" : "outline"}>
                        {t.statuses[shift.status as keyof typeof t.statuses] ?? shift.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <EditShiftButton
                          shift={shift}
                          eventId={event.id}
                          assignableUsers={assignableUsers}
                        />
                        <UnassignShiftButton shiftId={shift.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
