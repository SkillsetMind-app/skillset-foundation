import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/domain/auth";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import type { Permission } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  session: { status: "loading", user: null } as AuthSession,
  pathname: "/account",
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.session,
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

const learner = {
  uid: "u-1",
  email: "learner@example.com",
  emailVerified: true,
  displayName: "Learner",
  photoURL: null,
  roles: ["student" as const],
};

function renderGuarded() {
  return render(
    <ProtectedSurface permissions={["auth.signOut"]}>
      <p>conteudo protegido</p>
    </ProtectedSurface>,
  );
}

// A-17: o unico guard de rota olhava loading, user e papeis — nunca o nivel de
// garantia. Uma sessao aal1 de conta com TOTP tinha `user` preenchido e papeis
// validos, entao o conteudo abria sem o codigo.
describe("ProtectedSurface — senha aceita, codigo ainda nao", () => {
  afterEach(cleanup);

  it("mfa_required nunca abre o conteudo, mesmo com user e papeis presentes", () => {
    // Defensivo de proposito: ainda que um provider futuro anexe o usuario a
    // este estado, o guard decide pelo status, nao pelo `user`.
    mocks.session = { status: "mfa_required", user: learner };

    renderGuarded();

    expect(screen.queryByText("conteudo protegido")).toBeNull();
    // A saida e a tela do codigo, que retoma o desafio e devolve para ca.
    expect(
      screen.getByRole("link", { name: "auth.verify" }).getAttribute("href"),
    ).toBe("/login?returnTo=%2Faccount");
  });

  it("a mesma pessoa, com o codigo apresentado, ve o conteudo", () => {
    mocks.session = { status: "authenticated", user: learner };

    renderGuarded();

    expect(screen.getByText("conteudo protegido")).toBeTruthy();
  });

  // A-21: o muro era um cartao solto, sem logo, com titulo de 48px.
  it("o muro usa a moldura e o titulo das telas de entrada", () => {
    mocks.session = { status: "unauthenticated", user: null };
    const { container } = renderGuarded();

    expect(container.querySelector(".auth-split .auth-card")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { level: 1, name: "auth.guard.signInTitle" });
    expect(heading).toHaveClass("auth-title");
    expect(heading).not.toHaveClass("text-5xl");
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("carries the guarded path and query into both sign-in and account creation", () => {
    mocks.session = { status: "unauthenticated", user: null };
    const originalUrl = window.location.href;
    try {
      window.history.replaceState(null, "", "/account?section=billing&from=course");
      renderGuarded();
      for (const name of ["auth.guard.signIn", "auth.guard.createAccount"]) {
        const destination = new URL(screen.getByRole("link", { name }).getAttribute("href")!, "https://skillset.test");
        expect(destination.searchParams.get("returnTo")).toBe("/account?section=billing&from=course");
      }
      expect(screen.queryByText("conteudo protegido")).toBeNull();
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  });

  // /support signed out used to offer only "Sign in" / "Create account": a
  // visitor who could not sign in had no way to reach anyone.
  it("points a signed-out visitor to /contact when the page asks for it", () => {
    mocks.session = { status: "unauthenticated", user: null };

    render(
      <ProtectedSurface permissions={["auth.signOut"]} contactWhenSignedOut>
        <p>conteudo protegido</p>
      </ProtectedSurface>,
    );

    expect(screen.getByRole("link", { name: "auth.guard.contactSupport" }).getAttribute("href")).toBe("/contact");
    expect(screen.getByRole("link", { name: "auth.guard.signIn" }).getAttribute("href")).toMatch(/^\/login\?returnTo=/);
    expect(screen.queryByText("conteudo protegido")).toBeNull();
  });

  // O-16: o professor que pulou a ativacao e barrado no /teach; o botao tem
  // de levar a ativacao de professor, nao ao cadastro antigo de aluno.
  it.each([
    [["teacherStudio.access"], "/onboarding?path=teacher"],
    [["users.manage"], "/onboarding"],
  ] as const)("limited wall for %s points to %s", (permissions, href) => {
    mocks.session = { status: "authenticated", user: learner };

    render(
      <ProtectedSurface permissions={permissions}>
        <p>conteudo protegido</p>
      </ProtectedSurface>,
    );

    expect(screen.queryByText("conteudo protegido")).toBeNull();
    expect(screen.getByRole("link", { name: "auth.guard.updateOnboarding" }).getAttribute("href")).toBe(href);
  });

  it("keeps account creation on every other signed-out wall", () => {
    mocks.session = { status: "unauthenticated", user: null };

    renderGuarded();

    expect(screen.getByRole("link", { name: "auth.guard.createAccount" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "auth.guard.contactSupport" })).toBeNull();
  });
});

// F-03, estagio 0: a espera de toda pagina protegida era um anel numa pagina
// vazia, e a casca (barra lateral, topo, conteudo) entrava depois de uma vez.
describe("ProtectedSurface — a espera tem a forma do que vem", () => {
  afterEach(() => {
    cleanup();
    mocks.pathname = "/account";
    document.cookie = "skillset_sidebar=; path=/; max-age=0";
  });

  function renderLoading(pathname: string) {
    mocks.session = { status: "loading", user: null };
    mocks.pathname = pathname;
    return renderGuarded().container;
  }

  it.each([
    "/teach",
    "/teach/sales/order-1",
    "/teach/builder",
    "/teach/courses/c-1/manage",
    "/account",
    "/account/billing/upgrade",
    "/learn",
    "/learn/credentials",
    "/ops",
    "/ops/users/u-1",
    "/support",
  ])("%s espera com a casca da plataforma: inerte, um aviso so", (pathname) => {
    const container = renderLoading(pathname);

    for (const piece of [".platform-grid", ".platform-sidebar", ".platform-topbar", ".platform-content", ".platform-mobile-nav"]) {
      expect(container.querySelector(piece), piece).toBeInTheDocument();
    }
    // Um role="status" so, com a frase de antes, e nada mais escrito na tela:
    // nem nome da pessoa nem rotulo do menu.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("authFlow.loading.title");
    expect(container.textContent).toBe("authFlow.loading.title");
    // Quem anda pelos titulos acha o mesmo h1 do anel, so que sem aparecer.
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    const heading = screen.getByRole("heading", { level: 1, name: "authFlow.loading.title" });
    expect(heading).toHaveClass("sr-only");
    expect(screen.getByRole("status")).toContainElement(heading);
    // Nada que o teclado alcance.
    expect(container.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // As formas sao decorativas: fora da arvore do leitor de tela.
    for (const piece of [".platform-sidebar", ".platform-topbar", ".platform-mobile-nav"]) {
      expect(container.querySelector(piece)).toHaveAttribute("aria-hidden", "true");
    }
    for (const block of screen.getByRole("status").children) {
      if (!block.classList.contains("sr-only")) expect(block).toHaveAttribute("aria-hidden", "true");
    }
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.queryByText("conteudo protegido")).toBeNull();
  });

  // Na duvida, o anel: a sala de aula e a area de membros tem outra casca, a
  // previa do curso tambem, o certificado nao tem casca, e rota fora da lista
  // (checkout, cadastro) nao e adivinhada.
  it.each([
    "/learn/courses/intro",
    "/learn/areas/maria/ana",
    "/teach/builder/c-1/preview",
    "/learn/credentials/cert-1",
    "/checkout/course-1",
    "/onboarding",
    "/teaching",
    "",
  ])("%s mantem o anel de sempre", (pathname) => {
    const container = renderLoading(pathname);

    expect(container.querySelector(".platform-grid")).toBeNull();
    expect(screen.getByRole("status")).toContainElement(
      screen.getByRole("heading", { level: 1, name: "authFlow.loading.title" }),
    );
  });

  it("le a barra recolhida como a casca le (o cookie da escolha)", () => {
    document.cookie = "skillset_sidebar=collapsed; path=/";
    const container = renderLoading("/teach/sales");

    expect(container.querySelector(".platform-grid")).toHaveClass("platform-grid--collapsed");
    expect(container.querySelector(".platform-grid")).not.toHaveClass("platform-grid--auto");
    expect(container.querySelector(".platform-sidebar")).toHaveClass("sidebar-collapsed");
  });

  it("sem escolha salva, a largura do 1o quadro fica com o CSS", () => {
    const container = renderLoading("/teach/sales");

    expect(container.querySelector(".platform-grid")).toHaveClass("platform-grid--auto");
    expect(container.querySelector(".platform-grid")).not.toHaveClass("platform-grid--collapsed");
  });
});

// F-03, estagio 0: so o que a espera desenha mudou. Os muros (sem conta, codigo
// pendente, sem permissao) foram gravados ANTES da mudanca e tem de sair iguais,
// letra por letra, numa rota da casca e numa da sala de aula.
describe("ProtectedSurface — os muros nao mudam com a espera nova", () => {
  afterEach(() => {
    cleanup();
    mocks.pathname = "/account";
  });

  function wall(session: AuthSession, permissions: readonly Permission[] = ["auth.signOut"], contact = false) {
    mocks.session = session;
    const { container } = render(
      <ProtectedSurface permissions={permissions} contactWhenSignedOut={contact}>
        <p>conteudo protegido</p>
      </ProtectedSurface>,
    );
    expect(container.querySelector(".auth-split")).toBeInTheDocument();
    return container.querySelector(".auth-card")!.innerHTML;
  }

  it("numa rota da casca da plataforma (/teach/sales)", () => {
    mocks.pathname = "/teach/sales";
    expect(wall({ status: "unauthenticated", user: null })).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.signInEyebrow</p><h1 class="auth-title display-title">auth.guard.signInTitle</h1><p class="auth-description">auth.guard.signInDescription</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/login?returnTo=%2Fteach%2Fsales">auth.guard.signIn</a><a class="button-outline px-4 py-2.5 text-sm" href="/auth?mode=signup&amp;returnTo=%2Fteach%2Fsales">auth.guard.createAccount</a></div>"`);
    cleanup();
    expect(wall({ status: "unauthenticated", user: null }, ["auth.signOut"], true)).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.signInEyebrow</p><h1 class="auth-title display-title">auth.guard.signInTitle</h1><p class="auth-description">auth.guard.signInDescription</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/login?returnTo=%2Fteach%2Fsales">auth.guard.signIn</a><a class="button-outline px-4 py-2.5 text-sm" href="/contact">auth.guard.contactSupport</a></div>"`);
    cleanup();
    expect(wall({ status: "mfa_required", user: learner })).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.signInEyebrow</p><h1 class="auth-title display-title">auth.mfaTitle</h1><p class="auth-description">auth.mfaSubtitle</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/login?returnTo=%2Fteach%2Fsales">auth.verify</a></div>"`);
    cleanup();
    expect(wall({ status: "authenticated", user: learner }, ["teacherStudio.access"])).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.limitedEyebrow</p><h1 class="auth-title display-title">auth.guard.limitedTitle</h1><p class="auth-description">auth.guard.limitedDescription</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/onboarding?path=teacher">auth.guard.updateOnboarding</a><a class="button-outline px-4 py-2.5 text-sm" href="/contact">auth.guard.contactSupport</a></div>"`);
  });

  it("numa rota da sala de aula (/learn/courses/intro)", () => {
    mocks.pathname = "/learn/courses/intro";
    expect(wall({ status: "unauthenticated", user: null })).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.signInEyebrow</p><h1 class="auth-title display-title">auth.guard.signInTitle</h1><p class="auth-description">auth.guard.signInDescription</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/login?returnTo=%2Flearn%2Fcourses%2Fintro">auth.guard.signIn</a><a class="button-outline px-4 py-2.5 text-sm" href="/auth?mode=signup&amp;returnTo=%2Flearn%2Fcourses%2Fintro">auth.guard.createAccount</a></div>"`);
    cleanup();
    expect(wall({ status: "mfa_required", user: learner })).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.signInEyebrow</p><h1 class="auth-title display-title">auth.mfaTitle</h1><p class="auth-description">auth.mfaSubtitle</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/login?returnTo=%2Flearn%2Fcourses%2Fintro">auth.verify</a></div>"`);
    cleanup();
    expect(wall({ status: "authenticated", user: learner }, ["users.manage"])).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.limitedEyebrow</p><h1 class="auth-title display-title">auth.guard.limitedTitle</h1><p class="auth-description">auth.guard.limitedDescription</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/onboarding">auth.guard.updateOnboarding</a><a class="button-outline px-4 py-2.5 text-sm" href="/contact">auth.guard.contactSupport</a></div>"`);
  });
});
