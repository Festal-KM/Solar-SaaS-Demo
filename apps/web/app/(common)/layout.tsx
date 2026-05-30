import { auth } from "@/auth";
import {
  RoleShell,
  Home,
  Calendar,
  Users,
  LineChart,
  Settings,
  Wallet,
  type NavEntry,
} from "@/components/layout/role-shell";

import type { ReactNode } from "react";

const wholesalerNav: NavEntry[] = [
  { label: "ホーム", href: "/dashboard", icon: Home },
  {
    label: "イベント管理",
    icon: Calendar,
    children: [
      { label: "レーンイベント一覧", href: "/line-events" },
      { label: "単発イベント一覧", href: "/events" },
      { label: "場所取り対応状況", href: "/venue-negotiations" },
      { label: "二次店希望一覧", href: "/lane-preferences" },
    ],
  },
  {
    label: "顧客管理",
    icon: Users,
    children: [
      { label: "顧客一覧", href: "/customers" },
      { label: "アポイント一覧", href: "/appointments" },
      { label: "契約一覧", href: "/contracts" },
      { label: "施工一覧", href: "/constructions" },
      { label: "申請一覧", href: "/applications" },
    ],
  },
  {
    label: "手数料管理",
    icon: Wallet,
    children: [
      { label: "手数料一覧", href: "/commissions" },
      { label: "手数料設定", href: "/commissions/settings" },
    ],
  },
  {
    label: "BIツール",
    icon: LineChart,
    children: [
      { label: "ダッシュボード", href: "/bi" },
      { label: "市況分析", href: "/bi/analysis" },
    ],
  },
  {
    label: "設定",
    icon: Settings,
    children: [
      { label: "マスタ管理", href: "/masters" },
      { label: "メンバー管理", href: "/members" },
      { label: "取引先管理", href: "/relationships" },
      { label: "監査ログ", href: "/audit-logs" },
    ],
  },
];

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

const saasAdminNav: NavEntry[] = [
  { label: "ホーム", href: "/saas-admin-dashboard", icon: Home },
  {
    label: "テナント管理",
    icon: Users,
    children: [
      { label: "テナント一覧", href: "/tenants" },
      { label: "プラン管理", href: "/plans" },
      { label: "請求状況", href: "/billing" },
    ],
  },
  {
    label: "設定",
    icon: Settings,
    children: [
      { label: "監査ログ", href: "/audit-logs" },
    ],
  },
];

export default async function CommonGroupLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const roles = session?.user?.roles ?? [];
  const isSaasAdmin = session?.user?.isSaasAdmin ?? false;

  let navItems: NavEntry[];
  if (isSaasAdmin) {
    navItems = saasAdminNav;
  } else if (roles.some((r) => r.startsWith("DEALER_"))) {
    navItems = dealerNav;
  } else {
    navItems = wholesalerNav;
  }

  return (
    <RoleShell navItems={navItems}>
      {children}
    </RoleShell>
  );
}
