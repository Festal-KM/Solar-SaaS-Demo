"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

// Row wrapper that makes the whole <tr> behave like a link to the detail page.
// Keeps the table-row layout (so the parent <table> alignment is preserved)
// while delegating navigation to next/navigation's router. Cells receive their
// content via children so the data-fetching server page stays in charge of
// formatting.
//
// Accessibility:
//   - role/tabIndex make the row focusable and announced as a button
//   - Enter / Space activate just like a real button
//   - We don't navigate when the click target is itself an <a> or <button>
//     (so nested links in cells still work as expected)

interface NegotiationRowProps {
  href: string;
  children: ReactNode;
}

export function NegotiationRow({ href, children }: NegotiationRowProps) {
  const router = useRouter();

  function shouldNavigate(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return true;
    // Don't hijack clicks on real interactive elements inside the row.
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
      className="hover:bg-mist-light focus-visible:bg-mist-light focus-visible:ring-electric-blue/40 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
    >
      {children}
    </tr>
  );
}
