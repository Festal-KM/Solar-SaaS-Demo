"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  LogOut,
  ChevronDown,
  Home,
  Calendar,
  Users,
  LineChart,
  Settings,
  Wallet,
  Package,
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

/* ── Brand logo ── */

function BrandLogo({ className }: { className?: string }) {
  return (
    <Link href="/dashboard" className={["inline-flex items-center", className ?? ""].join(" ")}>
      <Image
        src="/logo.png"
        alt={labels.brand}
        width={649}
        height={159}
        priority
        className="h-7 w-auto"
      />
    </Link>
  );
}

/* ── Animated hamburger button (CodePen tonkec のサイドバー参考)。
   active=true で 3 本バーが ✕ にモーフィングする。jQuery 版の
   .button.active .top/.bottom の rotateZ(±45deg) + middle 消失を Tailwind で再現。 ── */

function HamburgerButton({
  active,
  onClick,
  label,
  className,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={active}
      className={[
        "flex h-8 w-8 items-center justify-center rounded-md text-body-light hover:bg-surface-soft hover:text-ink transition-colors",
        className ?? "",
      ].join(" ")}
    >
      <span className="relative block h-[14px] w-[18px]">
        <span
          className={[
            "absolute left-0 block h-0.5 w-full rounded-full bg-current transition-all duration-300 ease-in-out",
            active ? "top-1/2 -translate-y-1/2 rotate-45" : "top-0",
          ].join(" ")}
        />
        <span
          className={[
            "absolute left-0 top-1/2 block h-0.5 w-full -translate-y-1/2 rounded-full bg-current transition-all duration-300 ease-in-out",
            active ? "opacity-0" : "opacity-100",
          ].join(" ")}
        />
        <span
          className={[
            "absolute left-0 block h-0.5 w-full rounded-full bg-current transition-all duration-300 ease-in-out",
            active ? "bottom-1/2 translate-y-1/2 -rotate-45" : "bottom-0",
          ].join(" ")}
        />
      </span>
    </button>
  );
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
  className,
}: {
  navItems: NavEntry[];
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <nav
      className={[
        "flex-1 px-2 pb-6 space-y-0.5 overflow-y-auto mt-2",
        className ?? "",
      ].join(" ")}
    >
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

  // ESC でモバイルサイドバーを閉じる（CodePen 参考: keyCode 27 → toggleSidebar）。
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // モバイルでドロワーを開いている間は背面スクロールを止める。
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen bg-canvas-light text-body-light">
      {/* ── Desktop Sidebar ── */}
      <aside
        className={[
          "hidden lg:flex lg:flex-col lg:shrink-0 border-r border-hairline-light bg-canvas-light transition-all duration-300",
          collapsed ? "lg:w-14" : "lg:w-56",
        ].join(" ")}
      >
        <div
          className={[
            "flex items-center h-14 border-b border-hairline-light",
            collapsed ? "justify-center px-1" : "justify-between px-3",
          ].join(" ")}
        >
          {!collapsed && <BrandLogo />}
          {/* 展開時は ✕（クリックで畳む）、折りたたみ時はハンバーガー（クリックで開く） */}
          <HamburgerButton
            active={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
            label={labels.nav.menu}
          />
        </div>

        <SidebarNav navItems={navItems} pathname={pathname} collapsed={collapsed} />
      </aside>

      {/* ── Mobile: 固定ハンバーガー（ドロワーより前面 z-60 に置き、開いている間は
          ✕ にモーフィングしてそのまま閉じるトグルになる） ── */}
      <div className="fixed left-3 top-2.5 z-[60] lg:hidden">
        <HamburgerButton
          active={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
          label={labels.nav.menu}
        />
      </div>

      {/* ── Mobile sidebar drawer（常時マウント + translate でスライド開閉） ── */}
      <div
        aria-hidden={!mobileOpen}
        onClick={() => setMobileOpen(false)}
        className={[
          "fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
      />
      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-hairline-light bg-canvas-light shadow-xl transition-transform duration-300 ease-in-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex h-14 items-center border-b border-hairline-light pl-12 pr-4">
          <BrandLogo />
        </div>
        {/* key を開閉でトグルして remount し、スタッガード表示を都度再生する */}
        <SidebarNav
          key={mobileOpen ? "open" : "closed"}
          navItems={navItems}
          pathname={pathname}
          collapsed={false}
          onNavigate={() => setMobileOpen(false)}
          className={mobileOpen ? "sidebar-stagger" : ""}
        />
      </aside>

      {/* ── Main column ── */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-14 items-center justify-between border-b border-hairline-light bg-canvas-light px-4 lg:px-6 shrink-0">
          <div className="flex items-center gap-3 pl-10 lg:pl-0">
            {/* モバイルではブランドロゴ（開閉ボタンは固定配置）。デスクトップは
                サイドバー側にロゴがあるのでここは非表示。 */}
            <BrandLogo className="lg:hidden" />
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
export { Home, Calendar, Users, LineChart, Settings, Wallet, Package };
