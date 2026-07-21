"use client";

import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { ThemeProvider } from "@/lib/theme/theme-provider";

// Member area = its own destination, structurally separate from the dashboard
// PlatformShell (no sidebar/rail). Parity with Hotmart's Club: an enrolled
// course opens as a standalone, Netflix-style surface instead of being embedded
// in the platform chrome — which read as "two layouts mixed together".
// EnrolledCourseWorkspace is already self-contained (own hero, player,
// curriculum); this shell only frames it with a slim top bar and a centered
// container so the members-area card isn't edge-to-edge.
export function MemberAreaShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <div className="flex min-h-screen flex-col bg-[var(--color-surface-soft)]">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 sm:px-6">
          <LogoWordmark href="/" nav />
          <Link
            href="/learn"
            className="button-outline inline-flex items-center gap-2 px-4 py-2 text-sm"
          >
            <LayoutDashboard aria-hidden size={16} strokeWidth={1.9} />
            Exit to dashboard
          </Link>
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </ThemeProvider>
  );
}
