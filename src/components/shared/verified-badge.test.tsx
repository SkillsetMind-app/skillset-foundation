import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { VerifiedBadge, VerifiedSeal } from "@/components/shared/verified-badge";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";
import type { ProfessionalVerification } from "@/domain/user-profile";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

// Toque/mouse: pointerdown, foco e clique, na ordem do navegador.
function tap(element: HTMLElement) {
  fireEvent.pointerDown(element);
  act(() => element.focus());
  fireEvent.click(element);
}

// Teclado: o foco chega sem ponteiro.
function keyboardFocus(element: HTMLElement) {
  act(() => element.focus());
}

const license: ProfessionalVerification = { kind: "license", verifiedAt: "2026-09-01T12:00:00.000Z" };
const coach: ProfessionalVerification = { kind: "evidence", verifiedAt: "2026-09-01T12:00:00.000Z" };

function renderBadge(verification: ProfessionalVerification, { locale = "en", compact = false } = {}) {
  return render(
    <I18nProvider initialLocale={locale as "en" | "es"}>
      <h1>Ana Souza</h1>
      <VerifiedBadge verification={verification} compact={compact} />
      <a href="/next">after</a>
    </I18nProvider>,
  );
}

describe("o selo", () => {
  it("é um quadrado com check e canto de 4px: sem círculo, sem o BadgeCheck do Lucide", () => {
    const { container } = render(<VerifiedSeal label="Verified professional" />);
    const svg = container.querySelector("svg")!;

    expect(svg).toHaveClass("verified-seal");
    expect(svg.querySelector("rect")).toHaveAttribute("rx", "4");
    expect(svg.querySelector("circle")).toBeNull();
    expect(svg.getAttribute("class")).not.toMatch(/lucide|badge-check/);
    // Na cor da marca (marinho/latão via .verified-seal), nunca um azul fixo.
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}|rgb\(/i);
    expect(screen.getByRole("img", { name: "Verified professional" })).toBe(svg);
  });

  it("sem rótulo é decorativo", () => {
    const { container } = render(<VerifiedSeal />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("rótulo", () => {
  it.each([
    ["en", "Verified professional"],
    ["es", "Profesional verificado"],
  ])("no perfil, as palavras ficam ao lado do nome (%s)", (locale, label) => {
    renderBadge(coach, { locale });
    const button = screen.getByRole("button", { name: label });
    expect(button).toHaveTextContent(label);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("compacto mostra só o selo, com nome acessível", () => {
    renderBadge(coach, { compact: true });
    const button = screen.getByRole("button", { name: "Verified professional" });
    expect(button).toHaveTextContent("");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("popover", () => {
  it("abre e fecha no clique (toque)", () => {
    renderBadge(coach);
    const button = screen.getByRole("button", { name: "Verified professional" });

    tap(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/reviewed this person's professional evidence/)).toBeInTheDocument();

    tap(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/reviewed this person's professional evidence/)).toBeNull();
  });

  it("abre no foco do teclado, Enter não fecha, Esc fecha e devolve o foco", () => {
    renderBadge(coach);
    const button = screen.getByRole("button", { name: "Verified professional" });

    keyboardFocus(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    // Enter/Espaço viram clique sem ponteiro: quem abriu pelo foco não fecha.
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    // O link do popover é alcançável pelo teclado sem fechar.
    const trust = screen.getByRole("link", { name: "How verification works" });
    fireEvent.focusOut(button, { relatedTarget: trust });
    keyboardFocus(trust);
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(trust, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("fecha quando o foco sai e no clique fora", () => {
    renderBadge(coach);
    const button = screen.getByRole("button", { name: "Verified professional" });

    keyboardFocus(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.focusOut(button, { relatedTarget: screen.getByRole("link", { name: "after" }) });
    expect(button).toHaveAttribute("aria-expanded", "false");

    tap(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerDown(screen.getByRole("heading", { name: "Ana Souza" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("aponta para /trust e sempre avisa que resultados de curso não são verificados", () => {
    renderBadge(coach);
    tap(screen.getByRole("button", { name: "Verified professional" }));

    expect(screen.getByText("We don't verify results or claims made in courses.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How verification works" })).toHaveAttribute("href", "/trust");
  });
});

describe("o texto diz o que foi conferido e quando", () => {
  function statement(verification: ProfessionalVerification, locale = "en") {
    renderBadge(verification, { locale });
    tap(screen.getByRole("button"));
    return document.querySelector("[data-verified-popover]")!.textContent!;
  }

  it("license: a licença, com a data em inglês", () => {
    expect(statement(license)).toContain(
      "SkillsetMind checked this professional license on September 1, 2026.",
    );
  });

  it("evidence: a evidência profissional, sem prometer identidade", () => {
    const text = statement(coach);
    expect(text).toContain("SkillsetMind reviewed this person's professional evidence on September 1, 2026.");
    expect(text).not.toMatch(/identity/i);
  });

  it("em espanhol, a data no formato de lá", () => {
    expect(statement(license, "es")).toContain(
      "SkillsetMind comprobó esta licencia profesional el 1 de septiembre de 2026.",
    );
    cleanup();
    expect(statement(coach, "es")).toContain(
      "SkillsetMind revisó la evidencia profesional de esta persona el 1 de septiembre de 2026.",
    );
    expect(document.body.textContent).not.toMatch(/identidad/i);
  });

  it("caso aprovado sem data de revisão: a frase sem data, nunca uma data inventada", () => {
    const text = statement({ kind: "evidence", verifiedAt: null });
    expect(text).toContain("SkillsetMind reviewed this person's professional evidence.");
    expect(text).not.toMatch(/\bon\b\s*\./);
  });
});

// Restrição legal (EUA): o selo não certifica, não endossa, não credencia.
it.each([
  ["en", en.verifiedBadge, /certif|endors|accredit|licensed by|more students|rank/i],
  ["es", es.verifiedBadge, /certific|avalad|acreditad|licenciad[oa] por|más alumnos|más estudiantes/i],
] as const)("a copy do selo em %s não promete o que não foi feito", (_locale, copy, forbidden) => {
  expect(JSON.stringify(copy)).not.toMatch(forbidden);
});

// /trust e as faixas do login não dizem que todo mundo é verificado.
it.each([
  ["en", en, "Professional verification", /Verified professional/],
  ["es", es, "Verificación profesional", /Profesional verificado/],
] as const)("%s: /trust explica o selo opcional e os títulos não prometem verificação geral", (_locale, dict, title, badge) => {
  expect(dict.publicPages.trust.verified_professionals).toBe(title);
  const detail = dict.publicPages.trust.skillsetmind_verifies_professional_eligibility_before_publication;
  expect(detail).toMatch(badge);
  expect(detail).not.toMatch(/identity|identidad|eligibility|elegibilidad/i);
  for (const heading of [dict.auth.page.aside.teacher.point1Title, dict.auth.page.aside.learner.point1Title]) {
    expect(heading).not.toMatch(/^verified|verificad[oa]s$/i);
  }
});
