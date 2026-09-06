import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/domain/auth";
import { ProtectedSurface } from "@/components/auth/protected-surface";

const mocks = vi.hoisted(() => ({
  session: { status: "loading", user: null } as AuthSession,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.session,
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/account" }));

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
});
