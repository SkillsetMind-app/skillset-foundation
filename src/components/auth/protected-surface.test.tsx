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

// A-17: the only route guard looked at loading, user and roles — never the assurance
// level. An aal1 session of an account with TOTP had `user` filled in and valid
// roles, so the content opened without the code.
describe("ProtectedSurface — password accepted, code not yet", () => {
  afterEach(cleanup);

  it("mfa_required never opens the content, even with user and roles present", () => {
    // Defensive on purpose: even if a future provider attaches the user to
    // this state, the guard decides by status, not by `user`.
    mocks.session = { status: "mfa_required", user: learner };

    renderGuarded();

    expect(screen.queryByText("conteudo protegido")).toBeNull();
    // The exit is the code screen, which resumes the challenge and sends back here.
    expect(
      screen.getByRole("link", { name: "auth.verify" }).getAttribute("href"),
    ).toBe("/login?returnTo=%2Faccount");
  });

  it("the same person, with the code presented, sees the content", () => {
    mocks.session = { status: "authenticated", user: learner };

    renderGuarded();

    expect(screen.getByText("conteudo protegido")).toBeTruthy();
  });

  // A-21: the wall was a loose card, with no logo, with a 48px title.
  it("the wall uses the frame and title of the entry screens", () => {
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

  // O-16: the teacher who skipped the activation is blocked at /teach; the button has
  // to lead to the teacher activation, not to the old learner signup.
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

// F-03, stage 0: the wait on every protected page was a ring on an empty page,
// and the shell (sidebar, top bar, content) came in afterwards all at once.
describe("ProtectedSurface — the wait has the shape of what comes next", () => {
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
  ])("%s waits with the platform shell: inert, a single notice", (pathname) => {
    const container = renderLoading(pathname);

    for (const piece of [".platform-grid", ".platform-sidebar", ".platform-topbar", ".platform-content", ".platform-mobile-nav"]) {
      expect(container.querySelector(piece), piece).toBeInTheDocument();
    }
    // A single role="status", with the same sentence as before, and nothing else written on screen:
    // neither the person's name nor the menu label.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("authFlow.loading.title");
    expect(container.textContent).toBe("authFlow.loading.title");
    // Whoever walks through the headings finds the same h1 as the ring, just not visible.
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    const heading = screen.getByRole("heading", { level: 1, name: "authFlow.loading.title" });
    expect(heading).toHaveClass("sr-only");
    expect(screen.getByRole("status")).toContainElement(heading);
    // Nothing the keyboard can reach.
    expect(container.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // The shapes are decorative: outside the screen reader tree.
    for (const piece of [".platform-sidebar", ".platform-topbar", ".platform-mobile-nav"]) {
      expect(container.querySelector(piece)).toHaveAttribute("aria-hidden", "true");
    }
    for (const block of screen.getByRole("status").children) {
      if (!block.classList.contains("sr-only")) expect(block).toHaveAttribute("aria-hidden", "true");
    }
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.queryByText("conteudo protegido")).toBeNull();
  });

  // When in doubt, the ring: the classroom and the members area have another shell, the
  // course preview too, the certificate has no shell, and a route outside the list
  // (checkout, signup) is not guessed.
  it.each([
    "/learn/courses/intro",
    "/learn/areas/maria/ana",
    "/teach/builder/c-1/preview",
    "/learn/credentials/cert-1",
    "/checkout/course-1",
    "/onboarding",
    "/teaching",
    "",
  ])("%s keeps the usual ring", (pathname) => {
    const container = renderLoading(pathname);

    expect(container.querySelector(".platform-grid")).toBeNull();
    expect(screen.getByRole("status")).toContainElement(
      screen.getByRole("heading", { level: 1, name: "authFlow.loading.title" }),
    );
  });

  it("reads the collapsed bar the way the shell does (the choice cookie)", () => {
    document.cookie = "skillset_sidebar=collapsed; path=/";
    const container = renderLoading("/teach/sales");

    expect(container.querySelector(".platform-grid")).toHaveClass("platform-grid--collapsed");
    expect(container.querySelector(".platform-grid")).not.toHaveClass("platform-grid--auto");
    expect(container.querySelector(".platform-sidebar")).toHaveClass("sidebar-collapsed");
  });

  it("with no saved choice, the width of the 1st frame is left to CSS", () => {
    const container = renderLoading("/teach/sales");

    expect(container.querySelector(".platform-grid")).toHaveClass("platform-grid--auto");
    expect(container.querySelector(".platform-grid")).not.toHaveClass("platform-grid--collapsed");
  });
});

// F-03, stage 0: only what the wait draws changed. The walls (no account, code
// pending, no permission) were recorded BEFORE the change and must come out the same,
// letter by letter, on a shell route and on a classroom one.
describe("ProtectedSurface — the walls do not change with the new wait", () => {
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

  it("on a platform shell route (/teach/sales)", () => {
    mocks.pathname = "/teach/sales";
    expect(wall({ status: "unauthenticated", user: null })).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.signInEyebrow</p><h1 class="auth-title display-title">auth.guard.signInTitle</h1><p class="auth-description">auth.guard.signInDescription</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/login?returnTo=%2Fteach%2Fsales">auth.guard.signIn</a><a class="button-outline px-4 py-2.5 text-sm" href="/auth?mode=signup&amp;returnTo=%2Fteach%2Fsales">auth.guard.createAccount</a></div>"`);
    cleanup();
    expect(wall({ status: "unauthenticated", user: null }, ["auth.signOut"], true)).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.signInEyebrow</p><h1 class="auth-title display-title">auth.guard.signInTitle</h1><p class="auth-description">auth.guard.signInDescription</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/login?returnTo=%2Fteach%2Fsales">auth.guard.signIn</a><a class="button-outline px-4 py-2.5 text-sm" href="/contact">auth.guard.contactSupport</a></div>"`);
    cleanup();
    expect(wall({ status: "mfa_required", user: learner })).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.signInEyebrow</p><h1 class="auth-title display-title">auth.mfaTitle</h1><p class="auth-description">auth.mfaSubtitle</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/login?returnTo=%2Fteach%2Fsales">auth.verify</a></div>"`);
    cleanup();
    expect(wall({ status: "authenticated", user: learner }, ["teacherStudio.access"])).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.limitedEyebrow</p><h1 class="auth-title display-title">auth.guard.limitedTitle</h1><p class="auth-description">auth.guard.limitedDescription</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/onboarding?path=teacher">auth.guard.updateOnboarding</a><a class="button-outline px-4 py-2.5 text-sm" href="/contact">auth.guard.contactSupport</a></div>"`);
  });

  it("on a classroom route (/learn/courses/intro)", () => {
    mocks.pathname = "/learn/courses/intro";
    expect(wall({ status: "unauthenticated", user: null })).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.signInEyebrow</p><h1 class="auth-title display-title">auth.guard.signInTitle</h1><p class="auth-description">auth.guard.signInDescription</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/login?returnTo=%2Flearn%2Fcourses%2Fintro">auth.guard.signIn</a><a class="button-outline px-4 py-2.5 text-sm" href="/auth?mode=signup&amp;returnTo=%2Flearn%2Fcourses%2Fintro">auth.guard.createAccount</a></div>"`);
    cleanup();
    expect(wall({ status: "mfa_required", user: learner })).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.signInEyebrow</p><h1 class="auth-title display-title">auth.mfaTitle</h1><p class="auth-description">auth.mfaSubtitle</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/login?returnTo=%2Flearn%2Fcourses%2Fintro">auth.verify</a></div>"`);
    cleanup();
    expect(wall({ status: "authenticated", user: learner }, ["users.manage"])).toMatchInlineSnapshot(`"<p class="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">auth.guard.limitedEyebrow</p><h1 class="auth-title display-title">auth.guard.limitedTitle</h1><p class="auth-description">auth.guard.limitedDescription</p><div class="mt-6 flex flex-wrap gap-3"><a class="button-solid px-4 py-2.5 text-sm" href="/onboarding">auth.guard.updateOnboarding</a><a class="button-outline px-4 py-2.5 text-sm" href="/contact">auth.guard.contactSupport</a></div>"`);
  });
});
