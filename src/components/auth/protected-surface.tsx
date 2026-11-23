"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformShellSkeleton } from "@/components/shared/page-skeletons";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import { getAuthRoute } from "@/lib/auth/routing";
import { hasAnyPermission, type Permission } from "@/lib/permissions";
import { useSidebarState } from "@/lib/ui/sidebar-state";

type ProtectedSurfaceProps = {
  permissions: readonly Permission[];
  /** Signed out, offer /contact instead of account creation (the /support wall). */
  contactWhenSignedOut?: boolean;
  children: ReactNode;
};

export function ProtectedSurface({ permissions, contactWhenSignedOut = false, children }: ProtectedSurfaceProps) {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";

  if (status === "loading") {
    // Esta espera só aparece na carga inteira da página (atualizar, aba nova,
    // link de e-mail) e é o que o servidor manda: vindo de /loading ou de
    // /welcome a sessão já resolveu antes da troca de rota (o AuthProvider
    // mora no layout raiz e sobrevive a ela), e a página abre direto. Por
    // isso, nas telas da plataforma, a espera tem a forma da casca que vem, e
    // não o anel: a página é a melhor ponte para a página. No resto, o anel.
    // A frase é a mesma de sempre, para o leitor de tela.
    const label = t("authFlow.loading.title");
    const shell = shellWaitFor(pathname);
    return shell ? <ShellWait label={label} framed={shell.framed} /> : <SkillsetSpinner title={label} />;
  }

  if (status === "mfa_required" || !user) {
    // Preserve the deep link (path + query) through the sign-in wall so a
    // shared course/workspace URL lands back where the visitor was headed
    // instead of dying on the role dashboard. login-form validates it.
    //
    // Query read straight from window.location instead of useSearchParams():
    // the hook forces a CSR bailout that breaks static prerender on every
    // page using this guard. This branch only ever renders client-side —
    // during SSR/prerender, auth status is "loading" and the spinner above
    // renders instead — so window is always available here.
    const queryString =
      typeof window === "undefined"
        ? ""
        : window.location.search.replace(/^\?/, "");
    const destination = `${pathname}${queryString ? `?${queryString}` : ""}`;
    const loginHref = pathname
      ? `/login?returnTo=${encodeURIComponent(destination)}`
      : "/login";

    if (status === "mfa_required") {
      // A senha passou, o código não: sessão aal1 de conta com segundo fator.
      // Nunca é conteúdo. A tela de login retoma o desafio ao montar e volta
      // para cá pelo returnTo — sem este ramo o TOTP era decorativo (A-17).
      return (
        <AccessPanel
          eyebrow={t("auth.guard.signInEyebrow")}
          title={t("auth.mfaTitle")}
          description={t("auth.mfaSubtitle")}
          cta={{ href: loginHref, label: t("auth.verify") }}
        />
      );
    }

    return (
      <AccessPanel
        eyebrow={t("auth.guard.signInEyebrow")}
        title={t("auth.guard.signInTitle")}
        description={t("auth.guard.signInDescription")}
        cta={{ href: loginHref, label: t("auth.guard.signIn") }}
        secondary={contactWhenSignedOut
          ? { href: "/contact", label: t("auth.guard.contactSupport") }
          : { href: getAuthRoute("signup", null, destination), label: t("auth.guard.createAccount") }}
      />
    );
  }

  if (!hasAnyPermission({ roles: user.roles }, permissions)) {
    // Barrado na area de ensino = professor que pulou a ativacao. Sem o
    // ?path=teacher, /onboarding abria o cadastro antigo de 3 passos, com
    // "aprender" marcado, no lugar da ativacao de um passo que ele pulou.
    const teacherArea =
      permissions.some((permission) => permission.startsWith("teacherStudio."))
      || pathname === "/teach"
      || pathname.startsWith("/teach/");
    return (
      <AccessPanel
        eyebrow={t("auth.guard.limitedEyebrow")}
        title={t("auth.guard.limitedTitle")}
        description={t("auth.guard.limitedDescription")}
        cta={{
          href: teacherArea ? "/onboarding?path=teacher" : "/onboarding",
          label: t("auth.guard.updateOnboarding"),
        }}
        secondary={{ href: "/contact", label: t("auth.guard.contactSupport") }}
      />
    );
  }

  return children;
}

// Que espera mostrar, só pelo endereço (nunca por dado da pessoa). As áreas que
// abrem dentro da PlatformShell ganham a forma dela; rota fora da lista, o anel.
const SHELL_AREAS = ["/teach", "/learn", "/account", "/ops", "/support"];
// Dentro dessas áreas, as telas com outra casca: a sala de aula e a área de
// membros (MemberAreaShell), a prévia do curso no construtor (MemberAreaShell)
// e o certificado para imprimir (sem casca).
const OTHER_SHELLS = ["/learn/courses/", "/learn/areas/", "/learn/credentials/", "/teach/builder/"];
// As telas de pagar plano ficam na largura toda, como na PlatformShell.
const UNFRAMED_ACCOUNT = ["/account/billing/upgrade", "/account/billing/return", "/account/plans"];

function shellWaitFor(pathname: string) {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (!SHELL_AREAS.some(under) || OTHER_SHELLS.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }
  // A mesma coluna de 1280px da PlatformShell (`framed` em platform-shell.tsx),
  // conferida rota a rota contra ela em espera-com-a-forma-da-casca.test.tsx.
  const framed = (under("/teach") && !under("/teach/builder"))
    || under("/learn")
    || (under("/account") && !UNFRAMED_ACCOUNT.some((prefix) => pathname.startsWith(prefix)));
  return { framed };
}

// A barra recolhida é lida como a PlatformShell lê: o cookie que o layout leu
// no servidor vale no HTML e na hidratação (sem window na renderização), então
// a largura da coluna não muda quando a casca de verdade entra.
function ShellWait({ label, framed }: { label: string; framed: boolean }) {
  const { isCollapsed, isAuto } = useSidebarState();
  return <PlatformShellSkeleton label={label} collapsed={isCollapsed} auto={isAuto} framed={framed} />;
}

function AccessPanel({
  eyebrow,
  title,
  description,
  cta,
  secondary,
}: {
  eyebrow: string;
  title: string;
  description: string;
  cta?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  const { t } = useTranslation();

  // A mesma moldura e o mesmo tamanho de titulo das telas de entrada (logo,
  // idioma, volta ao inicio). Antes era um cartao solto, sem logo, com um
  // titulo de 48px que gritava.
  return (
    <AuthFrame homeLabel={t("auth.page.backToHome")}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {eyebrow}
      </p>
      <h1 className="auth-title display-title">{title}</h1>
      <p className="auth-description">{description}</p>
      {(cta || secondary) ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {cta ? (
            <Link href={cta.href} className="button-solid px-4 py-2.5 text-sm">
              {cta.label}
            </Link>
          ) : null}
          {secondary ? (
            <Link href={secondary.href} className="button-outline px-4 py-2.5 text-sm">
              {secondary.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </AuthFrame>
  );
}
