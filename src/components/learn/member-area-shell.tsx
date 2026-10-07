"use client";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { HelpMenu, type HelpCourse } from "@/components/platform/help-menu";
import { NotificationBell } from "@/components/platform/notification-bell";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { AccountMenu } from "@/components/site/account-menu";
import { AdvisorHeaderSlot } from "@/components/teacher/advisor-sidebar";
import type { MembersTheme } from "@/domain/teacher-course";
import { isStorefrontHexColor, readableTextOnAccent } from "@/domain/user-profile";
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
  course = null,
}: {
  children: ReactNode;
  brand?: MemberAreaBrand | null;
  theme?: MembersTheme;
  /** O curso desta sala: a Ajuda manda a duvida da aula para a comunidade
   *  dele (ou para a mensagem ao professor, se a comunidade estiver off). */
  course?: HelpCourse | null;
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
            ? ({
                "--ma-accent": accentColor,
                // The accent is a FILL under text: the text colour comes from
                // the accent itself, and hover keeps the accent instead of
                // falling back to the platform red under that text.
                "--ma-accent-hover": accentColor,
                "--ma-on-accent": readableTextOnAccent(accentColor),
              } as CSSProperties)
            : undefined
        }
      >
        <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-[var(--ma-line)] bg-[var(--ma-bg-top)] px-4 py-3 sm:px-6">
          {brand ? (
            // Whitelabel: the teacher's mark carries no link of ours. The
            // student still gets Help, the bell and the account menu below:
            // a class with no way to reach messages or support is a dead end.
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
            // tone fixo pelo tema do CURSO: a paleta --ma-* não segue o
            // <html>, então "auto" pintava o logo navy no cabeçalho escuro.
            // O logo leva para "My courses", nao para a home publica: quem
            // esta estudando quer voltar para os seus cursos, nao para a vitrine.
            <LogoWordmark href="/learn" nav tone={theme === "dark" ? "dark" : "light"} />
          )}
          <div className="flex shrink-0 items-center gap-2 empty:hidden">
            <AdvisorHeaderSlot />
            {/* Ajuda, sino e conta, aqui tambem — inclusive na sala com a
                marca do professor. Antes a sala tinha so o logo (e, sem marca,
                o sino): para chegar em mensagens, compras ou suporte o aluno
                precisava sair por "← My courses", e com a marca do professor
                nem o sino aparecia, embora o painel de mensagens diga que a
                resposta "cai no sino". A saida da sala continua UMA: "← My
                courses", na capa ou no cabecalho curto da aula. */}
            <HelpMenu variant="bar" side="student" course={course} />
            <MemberAreaAccount branded={Boolean(brand)} />
          </div>
        </header>
        {/* No side gutter below md: on a phone the classroom runs edge to edge
            so the lesson video can too (globals.css, .member-video-dock). The
            cards inside keep their own padding for text. */}
        <main className="mx-auto w-full max-w-[1280px] flex-1 py-6 md:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </ThemeProvider>
  );
}

function MemberAreaAccount({ branded }: { branded: boolean }) {
  const { status, user, signOut } = useAuth();

  return (
    <>
      <NotificationBell />
      {status === "authenticated" && user ? <AccountMenu user={user} onSignOut={signOut} branded={branded} /> : null}
    </>
  );
}
