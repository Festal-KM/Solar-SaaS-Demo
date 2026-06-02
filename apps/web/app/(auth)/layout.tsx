import Image from "next/image";

import { labels } from "@/lib/i18n/labels";

import type { ReactNode } from "react";

export default function AuthGroupLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-light-ash px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <header className="flex flex-col items-center text-center">
          <Image
            src="/logo.png"
            alt={labels.brand}
            width={649}
            height={159}
            priority
            className="h-12 w-auto"
          />
        </header>
        <section
          aria-label={labels.groups.auth}
          className="border border-border bg-white rounded-lg p-8"
        >
          {children}
        </section>
      </div>
    </main>
  );
}
