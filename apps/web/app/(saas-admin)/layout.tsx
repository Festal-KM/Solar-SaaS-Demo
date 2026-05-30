import {
  RoleShell,
  Home,
  Users,
  Settings,
  type NavEntry,
} from "@/components/layout/role-shell";

import type { ReactNode } from "react";

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

export default function SaasAdminGroupLayout({ children }: { children: ReactNode }) {
  return (
    <RoleShell navItems={saasAdminNav}>
      {children}
    </RoleShell>
  );
}
