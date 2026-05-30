import { labels } from "@/lib/i18n/labels";

import type { ReactNode } from "react";

// S-007〜S-012 onboarding shell. Identical visual treatment to (auth) — single
// centered column — but distinguished as a Route Group so middleware can gate
// invite / signup tokens separately.

export default function OnboardingGroupLayout({ children }: { children: ReactNode }) {
  return (
    <main className="bg-muted/30 flex min-h-screen w-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl space-y-6">
        <header className="flex flex-col items-center gap-1 text-center">
          <p className="text-xl font-semibold tracking-tight">{labels.brand}</p>
          <p className="text-muted-foreground text-sm">{labels.groups.onboarding}</p>
        </header>
        <section className="border-border bg-card rounded-lg border p-6 shadow-sm">
          {children}
        </section>
      </div>
    </main>
  );
}
