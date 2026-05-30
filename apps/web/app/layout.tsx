import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Solar SaaS",
  description: "太陽光卸・二次店営業管理 SaaS",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning className={inter.variable}>
      <body className="bg-background text-foreground min-h-screen antialiased font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
