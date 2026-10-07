import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const state = vi.hoisted(() => ({
  planId: "starter" as string,
  billing: { trialEligible: true, subscription: null } as Record<string, unknown>,
  cancel: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: vi.fn((_uid, onNext) => {
    onNext({ currentPlanId: state.planId });
    return vi.fn();
  }),
}));

vi.mock("@/lib/payments/billing", () => ({
  isCheckoutClientConfigured: () => true,
  openBillingPortal: vi.fn(),
  fetchPlanBillingState: () => Promise.resolve(state.billing),
  cancelPlanSubscription: state.cancel,
}));

beforeEach(() => {
  state.planId = "starter";
  state.billing = { trialEligible: true, subscription: null };
  state.cancel.mockReset();
});

vi.mock("@/components/account/upgrade-modal", () => ({
  UpgradeModal: () => null,
}));

describe("PlansPanel", () => {
  it("diz o plano atual UMA vez, numa linha, sem manchete", () => {
    render(<PlansPanel />);

    // A linha "Current plan: Starter" existe...
    expect(screen.getByText("Current plan:")).toBeInTheDocument();
    // ...e nao ha mais a manchete grande nem o botao desabilitado "Your plan".
    expect(
      screen.queryByRole("heading", { name: /^Starter$/ }),
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

describe("PlansPanel com os 2 planos e o teste gratis", () => {
  it("mostra so Basic, Starter e Pro, mesmo para quem ainda esta sem plano", () => {
    state.planId = "free";
    render(<PlansPanel />);

    const names = screen.getAllByRole("article").map((card) => card.querySelector("p")?.textContent);
    expect(names).toEqual(["Basic", "Starter", "Pro"]);
    expect(screen.queryByText("Enterprise")).not.toBeInTheDocument();
  });

  it("oferece o teste de 14 dias com os termos de renovacao junto do botao", async () => {
    state.planId = "free";
    render(<PlansPanel />);

    const pro = screen.getAllByRole("article")[2];
    const cta = await within(pro).findByRole("button", { name: "Start 14-day free trial" });
    expect(cta.parentElement).toHaveTextContent(
      /14 days free, then \$89\/month\. Renews automatically until you cancel\. Cancel anytime in Billing before .+ and you won't be charged\./,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Yearly" }));
    expect(pro).toHaveTextContent("14 days free, then $890/year.");
  });

  it("depois do teste usado, o botao volta a ser Upgrade e os termos nao prometem teste", async () => {
    state.planId = "free";
    state.billing = { trialEligible: false, subscription: null };
    render(<PlansPanel />);

    const pro = screen.getAllByRole("article")[2];
    expect(await within(pro).findByRole("button", { name: "Upgrade to Pro" })).toBeInTheDocument();
    expect(pro).toHaveTextContent("$89/month, starting today. Renews automatically until you cancel.");
    expect(pro).not.toHaveTextContent("days free");
  });

  it("durante o teste mostra quando ele termina e um Cancel plan que funciona", async () => {
    state.planId = "pro";
    state.billing = {
      trialEligible: false,
      subscription: {
        planId: "pro",
        cycle: "monthly",
        status: "trialing",
        trialEnd: "2026-10-20T12:00:00.000Z",
        currentPeriodEnd: "2026-10-20T12:00:00.000Z",
        cancelAtPeriodEnd: false,
      },
    };
    state.cancel.mockResolvedValue({ ...(state.billing.subscription as object), cancelAtPeriodEnd: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PlansPanel />);

    expect(await screen.findByText("Free trial — ends October 20, 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel plan" }));
    expect(window.confirm).toHaveBeenCalledWith(
      "Cancel your plan? Your free trial runs until October 20, 2026 and you won't be charged.",
    );
    expect(await screen.findByText("Ends on October 20, 2026")).toBeInTheDocument();
    expect(state.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Cancel plan" })).not.toBeInTheDocument();
  });

  it("um assinante Enterprise (ex-Plus) ve o proprio plano, sem cartao Enterprise a venda", () => {
    state.planId = "plus";
    render(<PlansPanel />);

    expect(screen.getByText("Current plan:").parentElement).toHaveTextContent("Enterprise");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
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
