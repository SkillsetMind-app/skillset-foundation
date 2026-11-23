import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlansPanel } from "@/components/account/plans-panel";
import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

// Na pagina de Planos o plano atual era dito tres vezes ("CURRENT PLAN / Free"
// flutuando como terceira manchete, o chip "Current" no cartao e o botao "Your
// plan"), e os quatro cartoes tinham alturas diferentes, entao os botoes
// "Upgrade" nao se alinhavam.

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      // Lido a cada render: trocar o uid simula uma nova leitura da cobrança.
      uid: state.uid,
      email: "teacher@example.com",
      displayName: "Teacher",
      emailVerified: true,
      photoURL: null,
      roles: ["teacher"],
    },
  }),
}));

const state = vi.hoisted(() => ({
  uid: "teacher-1",
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

// O "Cancel plan" pergunta num <dialog> da plataforma (não mais no
// window.confirm). O jsdom não tem showModal/close: o stub faz o mínimo que o
// navegador faz.
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

beforeEach(() => {
  state.uid = "teacher-1";
  state.planId = "starter";
  state.billing = { trialEligible: true, subscription: null };
  state.cancel.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  vi.useRealTimers();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

vi.mock("@/components/account/upgrade-modal", () => ({
  UpgradeModal: () => null,
}));

describe("PlansPanel", () => {
  it.each([500, 5000, 900, 9000, 0, 350])("shows actual next payment %s separately from new offers", async (amount) => {
    state.planId = "basic";
    state.billing = { trialEligible: false, subscription: {
      planId: "basic", cycle: "monthly", status: "active", trialEnd: null,
      currentPeriodEnd: "2026-11-03T12:00:00.000Z", cancelAtPeriodEnd: false,
      nextPayment: { amountMinor: amount, currency: "usd" },
    } };
    render(<PlansPanel />);
    expect(await screen.findByText(`Next payment: $${(amount / 100).toFixed(2)}`)).toBeInTheDocument();
    expect(screen.getAllByRole("article")[0]).toHaveTextContent("$9");
  });
  it("does not describe an account without a subscription as a free plan", () => {
    state.planId = "free";
    render(<PlansPanel />);
    expect(screen.getByText("No subscription")).toBeInTheDocument();
    expect(screen.queryByText(/^Free$/)).not.toBeInTheDocument();
  });

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
    expect(screen.getByText("Your plan tier")).toBeInTheDocument();
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

    // O seletor segmentado da casa (PeriodTabs): a escolha vai no proprio
    // botao (aria-pressed) e o tamanho vem da regra .studio-range-tabs.
    const monthly = screen.getByRole("button", { name: "Monthly" });
    expect(monthly).toHaveAttribute("aria-pressed", "true");
    expect(monthly.closest(".studio-range-tabs")).not.toBeNull();
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const start = css.indexOf(".studio-range-tabs button {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toMatch(/font-size: 0\.8125rem;/);
    expect(rule).not.toMatch(/uppercase/);
  });
});

describe("PlansPanel com os 2 planos e o teste gratis", () => {
  it.each([
    [500, "monthly", false], [5000, "yearly", false],
    [500, "monthly", true], [5000, "yearly", true],
  ])("separates legacy tariff %s/%s from current offers (cancelled %s)", async (amount, cycle, cancelled) => {
    state.planId = "basic";
    state.billing = { trialEligible: false, subscription: {
      planId: "basic", cycle, status: "active", trialEnd: null,
      currentPeriodEnd: "2026-11-03T12:00:00.000Z", cancelAtPeriodEnd: cancelled,
      contractedPrice: { amountMinor: amount, currency: "usd", cycle }, nextPayment: null,
    } };
    render(<PlansPanel />);
    expect(await screen.findByText(`Subscription price before discounts and tax: $${(Number(amount) / 100).toFixed(2)}/${cycle === "yearly" ? "year" : "month"}`)).toBeInTheDocument();
    const card = screen.getAllByRole("article")[0];
    expect(card).toHaveTextContent("Current offer for new subscriptions.");
    expect(within(card).queryByText("Current")).not.toBeInTheDocument();
    expect(within(card).queryByText("Your plan")).not.toBeInTheDocument();
    if (cancelled) expect(screen.queryByText(/^Next payment:/)).not.toBeInTheDocument();
    else expect(screen.getByText(/^Next payment:/)).not.toHaveTextContent("$9");
    fireEvent.click(screen.getByRole("button", { name: /^Yearly/ }));
    expect(card).toHaveTextContent("$90");
  });
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
    const cta = await within(pro).findByRole("button", { name: "Start your 14-day free trial" });
    expect(cta.parentElement).toHaveTextContent(
      /14-day free trial, then \$89\/month\. Renews automatically until you cancel\. Cancel anytime in Billing before .+ and you won't be charged\./,
    );

    // O desconto do anual está no próprio botão, não num title invisível.
    const yearly = screen.getByRole("button", { name: /^Yearly/ });
    expect(yearly).toHaveTextContent("~17% off");
    expect(yearly).not.toHaveAttribute("title");
    fireEvent.click(yearly);
    expect(pro).toHaveTextContent("14-day free trial, then $890/year.");
  });

  it("depois do teste usado, o botao volta a ser Upgrade e os termos nao prometem teste", async () => {
    state.planId = "free";
    state.billing = { trialEligible: false, subscription: null };
    render(<PlansPanel />);

    const pro = screen.getAllByRole("article")[2];
    expect(await within(pro).findByRole("button", { name: "Upgrade to Pro" })).toBeInTheDocument();
    expect(pro).toHaveTextContent("$89/month, starting today. Renews automatically until you cancel.");
    expect(pro).not.toHaveTextContent("free trial");
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
    // Só o Date é falso: o confirmar ignora cliques nos primeiros 500ms.
    vi.useFakeTimers({ toFake: ["Date"] });
    render(<PlansPanel />);

    expect(await screen.findByText("Free trial — ends October 20, 2026")).toBeInTheDocument();
    // Botão de verdade, no vermelho de perigo, e não um link dourado.
    const trigger = screen.getByRole("button", { name: "Cancel plan" });
    expect(trigger).toHaveClass("button-danger");
    fireEvent.click(trigger);

    // (a) a frase de sempre, agora dentro da janela da plataforma;
    const dialog = screen.getByRole("dialog", { name: "Cancel plan" });
    expect(dialog).toHaveTextContent(
      "Cancel your plan? Your free trial runs until October 20, 2026 and you won't be charged.",
    );
    // (b) abrir a pergunta não cancela nada;
    expect(state.cancel).not.toHaveBeenCalled();
    // (c) confirmar chama o cancelamento uma vez. Um clique colado na
    // abertura (toque duplo) é descartado.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel plan" }));
    expect(state.cancel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel plan" }));
    expect(await screen.findByText("Ends on October 20, 2026")).toBeInTheDocument();
    expect(state.cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Cancel plan" })).not.toBeInTheDocument();
  });

  it.each([
    ["past_due", "Cancel your plan now? The unpaid invoice won't be retried and the plan ends immediately."],
    ["unpaid", "Cancel your plan now? The unpaid invoice won't be retried and the plan ends immediately."],
    ["active", "Cancel your plan? It stays active until November 3, 2026 and won't renew."],
  ])("o Cancel plan de uma assinatura %s mostra o aviso certo", async (status, prompt) => {
    state.planId = "pro";
    state.billing = {
      trialEligible: false,
      subscription: {
        planId: "pro",
        cycle: "monthly",
        status,
        trialEnd: null,
        currentPeriodEnd: "2026-11-03T12:00:00.000Z",
        cancelAtPeriodEnd: false,
      },
    };
    state.cancel.mockResolvedValue({ ...(state.billing.subscription as object), cancelAtPeriodEnd: true });
    const nativeConfirm = vi.spyOn(window, "confirm");
    render(<PlansPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel plan" }));
    expect(screen.getByRole("dialog", { name: "Cancel plan" })).toHaveTextContent(prompt);
    expect(nativeConfirm).not.toHaveBeenCalled();
    // Desistir ("Keep plan") fecha sem enviar o pedido.
    fireEvent.click(screen.getByRole("button", { name: "Keep plan" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state.cancel).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it("cancelar agora (past_due) fecha a janela e ela não volta sozinha depois", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    state.planId = "pro";
    const pastDue = {
      planId: "pro",
      cycle: "monthly",
      status: "past_due",
      trialEnd: null,
      currentPeriodEnd: "2026-11-03T12:00:00.000Z",
      cancelAtPeriodEnd: false,
    };
    state.billing = { trialEligible: false, subscription: pastDue };
    // A rota encerra na hora e devolve subscription: null — a janela some sem
    // passar pelo onClose.
    state.cancel.mockResolvedValue(null);
    const { rerender } = render(<PlansPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel plan" }));
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel plan" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(state.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Cancel plan" })).not.toBeInTheDocument();

    // Uma assinatura volta a aparecer numa nova leitura: a pergunta não abre
    // sozinha, e o botão a abre de novo, limpa.
    state.uid = "teacher-2";
    state.billing = { trialEligible: false, subscription: { ...pastDue, status: "active" } };
    rerender(<PlansPanel />);
    const trigger = await screen.findByRole("button", { name: "Cancel plan" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Cancel plan" })).toHaveTextContent(
      "Cancel your plan? It stays active until November 3, 2026 and won't renew.",
    );
    expect(state.cancel).toHaveBeenCalledOnce();
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

describe("PlansPanel - plano que não carrega", () => {
  const defaultProfile = vi.mocked(subscribeToUserProfile).getMockImplementation()!;
  afterEach(() => {
    vi.mocked(subscribeToUserProfile).mockImplementation(defaultProfile);
  });

  it("ganha \"Try again\", que lê o perfil de novo uma vez só e mostra o plano", async () => {
    let failing = true;
    const reload = vi.fn();
    vi.mocked(subscribeToUserProfile).mockImplementation((_uid, onNext, onError) => {
      if (failing) onError(new Error("offline"));
      else onNext({ currentPlanId: "starter" } as never);
      return Object.assign(vi.fn(), {
        reload: async () => {
          reload();
          failing = false;
          onNext({ currentPlanId: "starter" } as never);
        },
      });
    });
    render(<PlansPanel />);
    expect(await screen.findByText(/We could not read your plan\./)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByText(/We could not read your plan\./)).toBeNull());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("erro de cancelar não ganha \"Try again\"", async () => {
    state.planId = "pro";
    state.billing = {
      trialEligible: false,
      subscription: {
        planId: "pro", cycle: "monthly", status: "active", trialEnd: null,
        currentPeriodEnd: "2026-11-03T12:00:00.000Z", cancelAtPeriodEnd: false,
      },
    };
    state.cancel.mockRejectedValue(new Error("boom"));
    vi.useFakeTimers({ toFake: ["Date"] });
    render(<PlansPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel plan" }));
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Cancel plan" })).getByRole("button", { name: "Cancel plan" }));
    expect(await screen.findByText("We couldn't cancel the plan. Try again, or use Manage subscription.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
