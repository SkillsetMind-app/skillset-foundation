import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusBanner } from "@/components/platform/status-banner";
import { StripeConnectNotice } from "@/components/teacher/stripe-connect-notice";

// O aviso do Stripe era uma faixa amarela FIXA no topo de todo o /teach, que so
// sumia quando a conta conectasse: dias ou semanas de alerta permanente, o que
// e o mesmo que nenhum alerta. Virou uma linha dispensavel, so onde se fala de
// dinheiro, que some sozinha quando cobrancas e repasses estao ligados.

const mocks = vi.hoisted(() => ({
  // true: o perfil ainda nao chegou (a inscricao nao responde).
  profilePending: false,
  // Termos ja aceitos de proposito: sem isso a faixa de termos dispara antes e
  // o teste "a faixa fixa nao existe mais" passaria mesmo com o ramo do Stripe
  // de volta no lugar.
  profile: {
    teacherTermsAcceptedAt: "2026-01-01T00:00:00.000Z",
    stripeConnectChargesEnabled: false,
    stripeConnectPayoutsEnabled: false,
  } as Record<string, unknown>,
}));

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

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "platform.banner.connectPayouts":
          "Connect your Stripe account before selling paid courses - buyers are charged on it directly.",
        "platform.banner.connectPayoutsCta": "Connect Stripe",
        "platform.banner.dismissNotice": "Dismiss this notice",
      })[key] ?? key,
  }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (
    _uid: string,
    onData: (profile: Record<string, unknown>) => void,
  ) => {
    if (!mocks.profilePending) onData(mocks.profile);
    return () => undefined;
  },
}));

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  mocks.profilePending = false;
  mocks.profile = {
    teacherTermsAcceptedAt: "2026-01-01T00:00:00.000Z",
    stripeConnectChargesEnabled: false,
    stripeConnectPayoutsEnabled: false,
  };
});

afterEach(cleanup);

describe("aviso do Stripe nas telas de venda", () => {
  it("a faixa fixa do topo nao existe mais", async () => {
    render(<StatusBanner />);

    await waitFor(() => {
      expect(screen.queryByText(/Connect your Stripe account/)).toBeNull();
    });
  });

  it("diz que o dinheiro cai direto na conta do professor, com caminho para conectar", async () => {
    render(<StripeConnectNotice />);

    expect(
      await screen.findByText(/buyers are charged on it directly/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Stripe" })).toHaveAttribute(
      "href",
      "/account/payments#stripe-connect",
    );
  });

  it("some ao ser dispensado e nao volta nesta sessao", async () => {
    const { unmount } = render(<StripeConnectNotice />);

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss this notice" }));
    expect(screen.queryByText(/buyers are charged on it directly/)).toBeNull();

    unmount();
    render(<StripeConnectNotice />);

    await waitFor(() => {
      expect(screen.queryByText(/buyers are charged on it directly/)).toBeNull();
    });
  });

  // O aviso esperava o perfil e empurrava a lista de vendas 117px para baixo.
  describe("antes de o perfil chegar", () => {
    const remember = (uid: string, ready: boolean) =>
      window.localStorage.setItem("skillset:stripe-connect-notice-last", JSON.stringify({ uid, ready }));

    it("quem nao tinha conectado na ultima visita ve o aviso desde o primeiro quadro", () => {
      mocks.profilePending = true;
      remember("teacher-1", false);
      render(<StripeConnectNotice />);

      expect(screen.getByText(/buyers are charged on it directly/)).toBeInTheDocument();
    });

    it.each([
      ["sem visita anterior", null],
      ["conta ja conectada na ultima visita", { uid: "teacher-1", ready: true }],
      ["ultima visita foi de outra pessoa", { uid: "someone-else", ready: false }],
    ])("%s: nada ate o perfil chegar", (_label, saved) => {
      mocks.profilePending = true;
      if (saved) remember(saved.uid, saved.ready);
      render(<StripeConnectNotice />);

      expect(screen.queryByText(/buyers are charged on it directly/)).toBeNull();
    });

    it("conectou desde a ultima visita: o aviso sai quando o perfil chega e a marca vira", async () => {
      remember("teacher-1", false);
      mocks.profile = { ...mocks.profile, stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true };
      render(<StripeConnectNotice />);

      await waitFor(() => {
        expect(screen.queryByText(/buyers are charged on it directly/)).toBeNull();
      });
      expect(JSON.parse(window.localStorage.getItem("skillset:stripe-connect-notice-last") ?? "{}")).toEqual({
        uid: "teacher-1",
        ready: true,
      });
    });
  });

  it("nao aparece quando a conta ja esta conectada", async () => {
    mocks.profile = {
      teacherTermsAcceptedAt: "2026-01-01T00:00:00.000Z",
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    };
    render(<StripeConnectNotice />);

    await waitFor(() => {
      expect(screen.queryByText(/buyers are charged on it directly/)).toBeNull();
    });
  });
});
