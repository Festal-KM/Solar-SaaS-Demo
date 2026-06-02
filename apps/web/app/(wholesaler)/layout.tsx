import {
  RoleShell,
  Home,
  Calendar,
  Users,
  LineChart,
  Settings,
  Wallet,
  Package,
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
      { label: "マエカク一覧", href: "/customers/maekaku" },
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
    label: "製品カタログ",
    icon: Package,
    children: [
      { label: "PVカタログ", href: "/product-catalog/pv" },
      { label: "BTカタログ", href: "/product-catalog/bt" },
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

export default function WholesalerGroupLayout({ children }: { children: ReactNode }) {
  return (
    <RoleShell navItems={wholesalerNav}>
      {children}
    </RoleShell>
  );
}
