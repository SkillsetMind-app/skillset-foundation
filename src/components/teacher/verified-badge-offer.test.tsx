import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import {
  BADGE_OFFER_SNOOZE_MS,
  VerifiedBadgeOffer,
} from "@/components/teacher/verified-badge-offer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderOffer(
  status: string | null = "none",
  { uid = "teacher-1", locale = "en" as "en" | "es", onDismiss = undefined as (() => void) | undefined } = {},
) {
  return render(
    <I18nProvider initialLocale={locale}>
      <VerifiedBadgeOffer uid={uid} name="Ana Souza" photoURL={null} verificationStatus={status} onDismiss={onDismiss} />
    </I18nProvider>,
  );
}

const offer = () => document.querySelector("[data-verified-badge-offer]");

describe("quem vê a oferta", () => {
  it.each(["none", "rejected"])("status %s vê", (status) => {
    renderOffer(status);
    expect(offer()).not.toBeNull();
  });

  // null = a leitura do perfil falhou ou não chegou: na dúvida, não oferece.
  it.each(["pending", "needs_changes", "approved", null])("status %s não vê", (status) => {
    renderOffer(status);
    expect(offer()).toBeNull();
  });
});

it("prévia com o próprio nome e o selo, e o botão leva ao pedido de verificação", () => {
  renderOffer();
  const preview = screen.getByText("Preview").closest("figure")!;
  expect(preview).toHaveTextContent("Ana Souza");
  expect(preview).toHaveTextContent("Verified professional");
  expect(preview.querySelector("[data-verified-seal]")).not.toBeNull();
  expect(screen.getByRole("link", { name: "Get it free (≈3 min)" })).toHaveAttribute("href", "/teach/verification");
});

it("diz que o selo só aparece depois da aprovação", () => {
  renderOffer();
  expect(offer()).toHaveTextContent("after approval");
  cleanup();
  renderOffer("none", { locale: "es" });
  expect(offer()).toHaveTextContent("tras la aprobación");
});

it("em espanhol", () => {
  renderOffer("none", { locale: "es" });
  expect(screen.getByRole("link", { name: "Obtenerlo gratis (≈3 min)" })).toHaveAttribute("href", "/teach/verification");
  expect(screen.getByRole("button", { name: "Ahora no" })).toBeInTheDocument();
  expect(screen.getByText("Profesional verificado")).toBeInTheDocument();
});

it("nunca promete alunos, vendas ou destaque", () => {
  renderOffer();
  expect(offer()!.textContent).not.toMatch(/student|sale|rank|featured|boost|certif|endors/i);
});

describe("Agora não", () => {
  it("o foco vai para onde quem chama mandar, não some com o cartão", () => {
    const target = document.createElement("p");
    target.tabIndex = -1;
    document.body.appendChild(target);
    renderOffer("none", { onDismiss: () => target.focus() });

    const notNow = screen.getByRole("button", { name: "Not now" });
    notNow.focus();
    fireEvent.click(notNow);

    expect(offer()).toBeNull();
    expect(target).toHaveFocus();
    target.remove();
  });

  it("adia por 21 dias, por uid", () => {
    renderOffer();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(offer()).toBeNull();
    expect(BADGE_OFFER_SNOOZE_MS).toBe(21 * DAY);

    // Outro professor no mesmo navegador não herda o adiamento.
    cleanup();
    renderOffer("none", { uid: "teacher-2" });
    expect(offer()).not.toBeNull();

    cleanup();
    vi.spyOn(Date, "now").mockReturnValue(NOW + 20 * DAY);
    renderOffer();
    expect(offer()).toBeNull();

    cleanup();
    vi.spyOn(Date, "now").mockReturnValue(NOW + 21 * DAY);
    renderOffer();
    expect(offer()).not.toBeNull();
  });

  it("depois da 3ª recusa não volta mais", () => {
    for (let round = 0; round < 3; round += 1) {
      vi.spyOn(Date, "now").mockReturnValue(NOW + round * 22 * DAY);
      renderOffer();
      expect(offer(), `rodada ${round + 1}`).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      cleanup();
    }

    vi.spyOn(Date, "now").mockReturnValue(NOW + 400 * DAY);
    renderOffer();
    expect(offer()).toBeNull();
  });

  it("com o storage bloqueado a oferta aparece e o Agora não esconde nesta visita", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderOffer();
    expect(offer()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(offer()).toBeNull();
  });
});
