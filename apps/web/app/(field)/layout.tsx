import {
  RoleShell,
  Home,
  Calendar,
  Users,
  type NavEntry,
} from "@/components/layout/role-shell";

import type { ReactNode } from "react";

const fieldNav: NavEntry[] = [
  { label: "ホーム", href: "/", icon: Home },
  { label: "シフト一覧", href: "/shifts", icon: Calendar },
  { label: "クイックアポ登録", href: "/quick-appointment", icon: Users },
];

export default function FieldGroupLayout({ children }: { children: ReactNode }) {
  return (
    <RoleShell navItems={fieldNav}>
      {children}
    </RoleShell>
  );
}
