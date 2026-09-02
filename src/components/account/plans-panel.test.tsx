import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { PlansPanel } from "@/components/account/plans-panel";

// Na pagina de Planos o plano atual era dito tres vezes ("CURRENT PLAN / Free"
// flutuando como terceira manchete, o chip "Current" no cartao e o botao "Your
// plan"), e os quatro cartoes tinham alturas diferentes, entao os botoes
// "Upgrade" nao se alinhavam.

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "teacher-1",
      email: "teacher@example.com",
      displayName: "Teacher",
      emailVerified: true,
      photoURL: null,
      roles: ["teacher"],
    },
  }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: vi.fn((_uid, onNext) => {
    onNext({ currentPlanId: "free" });
    return vi.fn();
  }),
}));

vi.mock("@/lib/payments/billing", () => ({
  isCheckoutClientConfigured: () => true,
  openBillingPortal: vi.fn(),
}));

vi.mock("@/components/account/upgrade-modal", () => ({
  UpgradeModal: () => null,
}));

describe("PlansPanel", () => {
  it("diz o plano atual UMA vez, numa linha, sem manchete", () => {
    render(<PlansPanel />);

    // A linha "Current plan: Free" existe...
    expect(screen.getByText("Current plan:")).toBeInTheDocument();
    // ...e nao ha mais a manchete grande nem o botao desabilitado "Your plan".
    expect(
      screen.queryByRole("heading", { name: /^Free$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Your plan" }),
    ).not.toBeInTheDocument();
    // O cartao marca o plano com o chip, e so.
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("alinha os botoes: cartao em coluna flex, acao empurrada para baixo", () => {
    render(<PlansPanel />);

    const cards = screen.getAllByRole("article");
    expect(cards.length).toBeGreaterThanOrEqual(2);
    for (const card of cards) {
      expect(card.className).toMatch(/\bflex\b/);
      expect(card.className).toMatch(/\bflex-col\b/);
      expect(card.className).toMatch(/\bh-full\b/);
      expect(card.querySelector(".mt-auto")).not.toBeNull();
    }
  });

  it("mostra o seletor Mensal/Anual em 13px sem caixa alta, na linha do titulo", () => {
    render(<PlansPanel />);

    const monthly = screen.getByRole("radio", { name: "Monthly" });
    expect(monthly.className).toMatch(/text-\[13px\]/);
    expect(monthly.className).not.toMatch(/\buppercase\b/);
  });
});

describe("a pagina de Planos", () => {
  it("abre nos cartoes: o cartao de abertura com a segunda manchete saiu", () => {
    const page = readFileSync(
      path.join(process.cwd(), "src/app/account/plans/page.tsx"),
      "utf8",
    );

    // A frase inteira e o que o JSX renderizava; o comentario que explica a
    // remocao cita so o comeco dela.
    expect(page).not.toContain("Choose the plan that fits your course business.");
    expect(page).not.toContain("platform-hero-card");
  });
});
