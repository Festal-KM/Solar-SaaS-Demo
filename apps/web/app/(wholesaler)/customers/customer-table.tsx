"use client";

import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { labels } from "@/lib/i18n/labels";

import type {
  ContractStatusValue,
  ConstructionStatusValue,
  CustomerListItem,
  MaekakuValue,
  SubsidyStatusValue,
} from "./constants";

function formatAppointment(iso: string | null): string {
  if (!iso) return labels.customer.none;
  const d = new Date(iso);
  const date = d.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} (${labels.customer.weekdays[d.getDay()]}) ${time}`;
}

function maekakuVariant(v: MaekakuValue): BadgeVariant {
  return v === "present" ? "success" : "secondary";
}

function contractVariant(v: ContractStatusValue): BadgeVariant {
  switch (v) {
    case "contracted":
      return "success";
    case "negotiating":
      return "default";
    case "lost":
      return "secondary";
    case "cancelled":
      return "destructive";
  }
}

function constructionVariant(v: ConstructionStatusValue): BadgeVariant {
  switch (v) {
    case "done":
      return "success";
    case "in_progress":
      return "warning";
    case "not_started":
      return "secondary";
  }
}

function subsidyVariant(v: SubsidyStatusValue): BadgeVariant {
  switch (v) {
    case "granted":
      return "success";
    case "applying":
      return "default";
    case "none":
      return "secondary";
  }
}

const TH =
  "whitespace-nowrap px-6 py-3 text-left text-xs font-medium text-mute-light uppercase tracking-wider";

interface CustomerTableProps {
  customers: CustomerListItem[];
}

export function CustomerTable({ customers }: CustomerTableProps) {
  const t = labels.customer;
  const router = useRouter();

  // 行クリック / Enter・Space で顧客詳細へ遷移。
  function goToDetail(id: string) {
    router.push(`/customers/${id}`);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline-light bg-surface-soft/50">
            <th className={TH}>{t.columns.name}</th>
            <th className={TH}>{t.columns.area}</th>
            <th className={TH}>{t.columns.assignee}</th>
            <th className={TH}>{t.columns.nextAppointmentAt}</th>
            <th className={TH}>{t.columns.maekaku}</th>
            <th className={TH}>{t.columns.contractStatus}</th>
            <th className={TH}>{t.columns.constructionStatus}</th>
            <th className={TH}>{t.columns.subsidyStatus}</th>
            <th className="w-10 px-3 py-3" aria-hidden />
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline-light">
          {customers.map((row) => (
            <tr
              key={row.id}
              tabIndex={0}
              role="button"
              aria-label={`${row.name}${t.honorific}`}
              className="cursor-pointer transition-colors hover:bg-mist-light active:bg-surface-soft focus:outline-none focus-visible:bg-mist-light focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
              onClick={() => goToDetail(row.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  goToDetail(row.id);
                }
              }}
            >
              <td className="whitespace-nowrap px-6 py-3 font-medium text-ink">
                {row.name}
                {t.honorific}
              </td>
              <td className="whitespace-nowrap px-6 py-3 text-body-light">{row.area ?? t.none}</td>
              <td className="whitespace-nowrap px-6 py-3 text-body-light">{row.assigneeName}</td>
              <td className="whitespace-nowrap px-6 py-3 tabular-nums text-body-light">
                {formatAppointment(row.nextAppointmentAt)}
              </td>
              <td className="px-6 py-3">
                <Badge variant={maekakuVariant(row.maekaku)}>{t.maekakuLabels[row.maekaku]}</Badge>
              </td>
              <td className="px-6 py-3">
                <Badge variant={contractVariant(row.contractStatus)}>
                  {t.contractStatusLabels[row.contractStatus]}
                </Badge>
              </td>
              <td className="px-6 py-3">
                <Badge variant={constructionVariant(row.constructionStatus)}>
                  {t.constructionStatusLabels[row.constructionStatus]}
                </Badge>
              </td>
              <td className="px-6 py-3">
                <Badge variant={subsidyVariant(row.subsidyStatus)}>
                  {t.subsidyStatusLabels[row.subsidyStatus]}
                </Badge>
              </td>
              <td className="px-3 py-3 text-right">
                <ChevronRight className="inline size-4 text-mute-light" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
