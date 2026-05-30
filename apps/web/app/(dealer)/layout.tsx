import {
  RoleShell,
  Home,
  Calendar,
  Users,
  LineChart,
  Settings,
  type NavEntry,
} from "@/components/layout/role-shell";

import type { ReactNode } from "react";

const dealerNav: NavEntry[] = [
  { label: "ホーム", href: "/d-dashboard", icon: Home },
  {
    label: "イベント",
    icon: Calendar,
    children: [
      { label: "公開イベント", href: "/visible-event-candidates" },
      { label: "担当イベント", href: "/d-events" },
    ],
  },
  {
    label: "顧客管理",
    icon: Users,
    children: [
      { label: "顧客一覧", href: "/d-customers" },
      { label: "アポ一覧", href: "/d-appointments" },
      { label: "商談", href: "/d-deals" },
      { label: "契約", href: "/d-contracts" },
    ],
  },
  { label: "成績", href: "/monthly", icon: LineChart },
  {
    label: "設定",
    icon: Settings,
    children: [
      { label: "月次報告", href: "/d-monthly-reports" },
      { label: "インセンティブ", href: "/incentives" },
      { label: "メンバー", href: "/d-members" },
      { label: "マエカク結果", href: "/d-notifications/pre-call" },
    ],
  },
];

export default function DealerGroupLayout({ children }: { children: ReactNode }) {
  return (
    <RoleShell navItems={dealerNav}>
      {children}
    </RoleShell>
  );
}
