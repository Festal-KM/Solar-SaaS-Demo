"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Home,
  Calendar,
  Users,
  LineChart,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { labels } from "@/lib/i18n/labels";
import { signOutAction } from "@/app/actions/sign-out";

import type { ReactNode } from "react";

/* ── Nav data types ── */

export interface NavLeaf {
  label: string;
  href: string;
}

export interface NavGroup {
  label: string;
  icon: LucideIcon;
  children: NavLeaf[];
}

export type NavEntry = (NavLeaf & { icon: LucideIcon }) | NavGroup;

function isGroup(e: NavEntry): e is NavGroup {
  return "children" in e;
}

export interface RoleShellProps {
  navItems?: NavEntry[];
  children: ReactNode;
}

/* ── Sidebar group (accordion) ── */

function SidebarGroup({
  group,
  pathname,
  collapsed,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  // 子要素のうち最長一致するもの 1 つだけをアクティブにする（"/commissions" と
  // "/commissions/settings" の同時ハイライトを防ぐ）。完全一致 OR 配下サブパスを
  // 拾い、最も長い href を勝者にする。
  const matchingChildren = group.children.filter(
    (c) => pathname === c.href || pathname.startsWith(c.href + "/"),
  );
  const activeChildHref =
    matchingChildren.length === 0
      ? null
      : matchingChildren.reduce((best, cur) =>
          cur.href.length > best.href.length ? cur : best,
        ).href;
  const hasActive = activeChildHref !== null;
  const [open, setOpen] = useState(hasActive);
  const Icon = group.icon;

  if (collapsed) {
    const firstHref = group.children[0]?.href ?? "/";
    return (
      <Link
        href={firstHref}
        title={group.label}
        className={[
          "flex items-center justify-center py-2.5 rounded-md transition-colors",
          hasActive ? "text-primary" : "text-body-light hover:bg-surface-soft hover:text-ink",
        ].join(" ")}
      >
        <Icon size={18} />
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={[
          "flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm transition-colors",
          hasActive ? "text-ink font-medium" : "text-body-light hover:bg-surface-soft hover:text-ink",
        ].join(" ")}
      >
        <Icon size={18} className="shrink-0" />
        <span className="flex-1 text-left truncate">{group.label}</span>
        <ChevronDown
          size={14}
          className={["shrink-0 text-mute-light transition-transform duration-200", open ? "rotate-180" : ""].join(" ")}
        />
      </button>
      <div
        className={[
          "grid transition-[grid-template-rows] duration-200 ease-in-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        ].join(" ")}
      >
        <div className="overflow-hidden">
          <div className="ml-5 pl-3 border-l border-hairline-light space-y-0.5 mt-0.5 mb-1">
            {group.children.map((child) => {
              const isActive = child.href === activeChildHref;
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  onClick={onNavigate}
                  className={[
                    "block rounded-md px-3 py-1.5 text-[13px] transition-colors",
                    isActive
                      ? "text-primary font-medium bg-primary/5"
                      : "text-body-light hover:bg-surface-soft hover:text-ink",
                  ].join(" ")}
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sidebar leaf (top-level link) ── */

function SidebarLeaf({
  item,
  icon: Icon,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: NavLeaf;
  icon: LucideIcon;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const isActive = item.href === "/dashboard" || item.href === "/d-dashboard" || item.href === "/saas-admin-dashboard"
    ? pathname === item.href
    : pathname.startsWith(item.href);

  if (collapsed) {
    return (
      <Link
        href={item.href}
        title={item.label}
        className={[
          "flex items-center justify-center py-2.5 rounded-md transition-colors",
          isActive ? "text-primary" : "text-body-light hover:bg-surface-soft hover:text-ink",
        ].join(" ")}
      >
        <Icon size={18} />
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={[
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        isActive
          ? "text-primary font-medium bg-primary/5"
          : "text-body-light hover:bg-surface-soft hover:text-ink",
      ].join(" ")}
    >
      <Icon size={18} className="shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

/* ── Sidebar content (shared between desktop and mobile) ── */

function SidebarNav({
  navItems,
  pathname,
  collapsed,
  onNavigate,
}: {
  navItems: NavEntry[];
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 px-2 pb-6 space-y-0.5 overflow-y-auto mt-2">
      {navItems.map((entry, i) =>
        isGroup(entry) ? (
          <SidebarGroup key={i} group={entry} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
        ) : (
          <SidebarLeaf key={entry.href} item={entry} icon={entry.icon} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
        ),
      )}
    </nav>
  );
}

/* ── Main Shell ── */

export function RoleShell({ navItems = [], children }: RoleShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-canvas-light text-body-light">
      {/* ── Desktop Sidebar ── */}
      <aside
        className={[
          "hidden lg:flex lg:flex-col lg:shrink-0 border-r border-hairline-light bg-canvas-light transition-all duration-300",
          collapsed ? "lg:w-14" : "lg:w-56",
        ].join(" ")}
      >
        <div className="flex items-center justify-between h-14 px-2 border-b border-hairline-light">
          {!collapsed && (
            <Link href="/dashboard" className="text-ink text-[15px] font-semibold tracking-tight px-2">
              {labels.brand}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center w-8 h-8 rounded-md text-mute-light hover:text-ink hover:bg-surface-soft transition-colors mx-auto"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <SidebarNav navItems={navItems} pathname={pathname} collapsed={collapsed} />
      </aside>

      {/* ── Mobile sidebar overlay ── */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-64 bg-canvas-light border-r border-hairline-light z-50 lg:hidden flex flex-col">
            <div className="flex items-center justify-between h-14 px-4 border-b border-hairline-light">
              <Link href="/dashboard" className="text-ink text-[15px] font-semibold tracking-tight">
                {labels.brand}
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-md text-mute-light hover:text-ink"
              >
                <ChevronLeft size={18} />
              </button>
            </div>
            <SidebarNav navItems={navItems} pathname={pathname} collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      {/* ── Main column ── */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-14 items-center justify-between border-b border-hairline-light bg-canvas-light px-4 lg:px-6 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label={labels.nav.menu}
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-md text-body-light hover:bg-surface-soft"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <span className="lg:hidden text-[15px] font-semibold text-ink tracking-tight">
              {labels.brand}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/notifications"
              aria-label={labels.nav.notifications}
              className="flex items-center justify-center w-8 h-8 rounded-md text-body-light hover:text-ink hover:bg-surface-soft transition-colors"
            >
              <Bell size={18} />
            </Link>
            <Link
              href="/profile"
              aria-label={labels.nav.profile}
              className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-surface-soft transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-surface-soft flex items-center justify-center">
                <span className="text-xs font-medium text-mute-light">U</span>
              </div>
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                aria-label={labels.signOut.ariaLabel}
                className="flex items-center justify-center w-8 h-8 rounded-md text-body-light hover:text-ink hover:bg-surface-soft transition-colors"
              >
                <LogOut size={16} />
              </button>
            </form>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8 overflow-auto">
          <div className="max-w-6xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}

/* ── Re-export icons for layout files ── */
export { Home, Calendar, Users, LineChart, Settings, Wallet };
