// Regression guard for the at-a-glance status → badge variant mappings.
//
// page.tsx (顧客詳細の at-a-glance 帯) and customer-table.tsx (一覧テーブル) must
// agree on how each status value maps to a badge variant. The list-table variant
// functions are the canonical source; this test pins the full (post-expansion)
// value domain so a future status addition cannot silently drift the two views.

import { describe, expect, it, vi } from "vitest";

// The variant functions are pure switch/return; mock the UI-only imports so the
// client module loads under the node test environment without a DOM.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("lucide-react", () => ({ ChevronRight: () => null }));
vi.mock("@/components/ui/badge", () => ({ Badge: () => null }));

const { contractVariant, constructionVariant, subsidyVariant, maekakuVariant } = await import(
  "../customer-table.js"
);

describe("status → badge variant (page at-a-glance ↔ list table)", () => {
  it("maps the full 7-value contract domain", () => {
    expect(contractVariant("contracted")).toBe("success");
    expect(contractVariant("contract_pending")).toBe("default");
    expect(contractVariant("quote_presented")).toBe("default");
    expect(contractVariant("negotiating")).toBe("default");
    expect(contractVariant("pre_visit")).toBe("secondary");
    expect(contractVariant("lost")).toBe("secondary");
    expect(contractVariant("cancelled")).toBe("destructive");
  });

  it("maps the 3-value construction domain", () => {
    expect(constructionVariant("done")).toBe("success");
    expect(constructionVariant("in_progress")).toBe("warning");
    expect(constructionVariant("not_started")).toBe("secondary");
  });

  it("maps the full 5-value subsidy domain", () => {
    expect(subsidyVariant("completed")).toBe("success");
    expect(subsidyVariant("applied")).toBe("default");
    expect(subsidyVariant("revising")).toBe("warning");
    expect(subsidyVariant("preparing")).toBe("default");
    expect(subsidyVariant("not_applied")).toBe("secondary");
  });

  it("maps maekaku", () => {
    expect(maekakuVariant("present")).toBe("success");
    expect(maekakuVariant("absent")).toBe("secondary");
  });
});
