"use client";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import { NotificationBell } from "@/components/platform/notification-bell";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import type { MembersTheme } from "@/domain/teacher-course";
import { isStorefrontHexColor } from "@/domain/user-profile";
import { ThemeProvider } from "@/lib/theme/theme-provider";

/**
 * The teacher's mark, when their plan includes `removePlatformBranding`. The
 * page resolves it server-side and passes it down; leaving it undefined keeps
 * the SkillsetMind wordmark, which is the correct default for every plan below
 * pro and for any lookup that fails.
 */
export type MemberAreaBrand = {
  name: string;
  logoUrl?: string | null;
  accentColor?: string | null;
};

// Member area = its own destination, structurally separate from the dashboard
// PlatformShell (no sidebar/rail). Parity with Hotmart's Club: an enrolled
// course opens as a standalone, Netflix-style surface instead of being embedded
// in the platform chrome — which read as "two layouts mixed together".
// EnrolledCourseWorkspace is already self-contained (own hero, player,
// curriculum); this shell only frames it with a slim top bar and a centered
// container so the members-area card isn't edge-to-edge.
//
// data-members-theme on THIS root is the load-bearing bit: globals.css declares
// the --ma-* palette on a bare `[data-members-theme="dark"]` selector, so the
// tokens inherit into the whole page instead of stopping at the inner
// .member-classroom card — which is why the shell used to stay light around a
// dark classroom.
export function MemberAreaShell({
  children,
  brand,
  theme = "light",
}: {
  children: ReactNode;
  brand?: MemberAreaBrand | null;
  theme?: MembersTheme;
}) {
  // Same guard-then-inline shape as the storefront hero: the projection already
  // sanitizes the value, this is the cheap second gate before it lands in a CSS
  // custom property. Scoped to this subtree, so it only overrides the platform
  // red inside the member area.
  const accentColor =
    brand?.accentColor && isStorefrontHexColor(brand.accentColor)
      ? brand.accentColor
      : null;

  return (
    <ThemeProvider>
      <div
        data-members-theme={theme}
        className="flex min-h-screen flex-col bg-[var(--ma-bg)] text-[var(--ma-ink)]"
        style={
          accentColor
            ? ({ "--ma-accent": accentColor } as CSSProperties)
            : undefined
        }
      >
        <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-[var(--ma-line)] bg-[var(--ma-bg-top)] px-4 py-3 sm:px-6">
          {brand ? (
            // Whitelabel: no href, and no door back into our dashboard. A
            // branded member area must not read as living inside our platform.
            brand.logoUrl ? (
              <span className="relative block h-8 w-32">
                <Image
                  src={brand.logoUrl}
                  alt={brand.name}
                  fill
                  sizes="128px"
                  className="object-contain object-left"
                  unoptimized
                />
              </span>
            ) : (
              <span className="text-lg font-semibold text-[var(--ma-ink)]">
                {brand.name}
              </span>
            )
          ) : (
            <>
              <LogoWordmark href="/" nav />
              {/* O sino da plataforma, aqui também. A sala de aula usa esta
                  casca (sem barra lateral) e ela não tinha sino: o painel de
                  mensagens dizia "a resposta cai no sino" numa tela onde o
                  sino não existia. Mesmo componente, mesma lista de avisos.
                  Fica fora do modo whitelabel de propósito: cada aviso leva a
                  uma página da plataforma, e a área com marca do professor
                  não pode ter porta de volta para dentro dela.

                  Um "Exit to dashboard" morava aqui ao lado. Era a terceira
                  saída para o mesmo lugar ("Back to dashboard" na capa, "Back
                  to My Learning" na lateral). A sala agora tem UMA: "← My
                  courses", na capa (página inicial) ou no cabeçalho curto
                  (em aula). */}
              <NotificationBell />
            </>
          )}
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </ThemeProvider>
  );
}
