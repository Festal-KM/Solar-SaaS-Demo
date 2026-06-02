"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

// Whole-row clickable wrapper for the venue-provider summary table in the
// masters hub. Behaves the same as the venue-negotiations row link — clicking
// anywhere on the row navigates to the detail page, while preserving native
// anchors/buttons inside the row.

interface VenueProviderRowProps {
  href: string;
  children: ReactNode;
}

export function VenueProviderRow({ href, children }: VenueProviderRowProps) {
  const router = useRouter();

  function shouldNavigate(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return true;
    return !target.closest("a, button, input, select, textarea, label");
  }

  function handleClick(event: MouseEvent<HTMLTableRowElement>) {
    if (!shouldNavigate(event.target)) return;
    router.push(href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!shouldNavigate(event.target)) return;
    event.preventDefault();
    router.push(href);
  }

  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="border-border hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-primary/40 border-t cursor-pointer align-top focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
    >
      {children}
    </tr>
  );
}
