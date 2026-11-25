import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { VerifiedBadge, VerifiedSeal } from "@/components/shared/verified-badge";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";
import type { ProfessionalVerification } from "@/domain/user-profile";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

// Touch/mouse: pointerdown, focus and click, in the browser's order.
function tap(element: HTMLElement) {
  fireEvent.pointerDown(element);
  act(() => element.focus());
  fireEvent.click(element);
}

// Keyboard: focus arrives without a pointer.
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

describe("the badge", () => {
  it("uses Lucide's cut-out BadgeCheck with brand colors and an accessible name", () => {
    const { container } = render(<VerifiedSeal label="Verified professional" />);
    const svg = container.querySelector("svg")!;

    expect(svg).toHaveClass("verified-seal");
    expect(svg.querySelector("rect")).toBeNull();
    expect(svg.querySelector("circle")).toBeNull();
    expect(svg).toHaveClass("lucide-badge-check");
    expect(svg).toHaveAttribute("fill", "var(--seal-ground)");
    expect(svg).toHaveAttribute("stroke", "var(--seal-mark)");
    expect(svg).toHaveAttribute("focusable", "false");
    // In the brand color (navy/brass via .verified-seal), never a fixed blue.
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}|rgb\(/i);
    expect(screen.getByRole("img", { name: "Verified professional" })).toBe(svg);
  });

  it("without a label it is decorative", () => {
    const { container } = render(<VerifiedSeal />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the explicit size and the caller's class without changing the geometry", () => {
    const { container } = render(<VerifiedSeal size={24} className="custom-seal" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("height", "24");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveClass("custom-seal");
  });
});

describe("rótulo", () => {
  it.each([
    ["en", "Verified professional"],
    ["es", "Profesional verificado"],
  ])("on the profile, the words sit next to the name (%s)", (locale, label) => {
    renderBadge(coach, { locale });
    const button = screen.getByRole("button", { name: label });
    expect(button).toHaveTextContent(label);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("compact shows only the badge, with an accessible name", () => {
    renderBadge(coach, { compact: true });
    const button = screen.getByRole("button", { name: "Verified professional" });
    expect(button).toHaveTextContent("");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("popover", () => {
  it("opens and closes on click (touch)", () => {
    renderBadge(coach);
    const button = screen.getByRole("button", { name: "Verified professional" });

    tap(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/reviewed this person's professional evidence/)).toBeInTheDocument();

    tap(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/reviewed this person's professional evidence/)).toBeNull();
  });

  it("opens on keyboard focus, Enter does not close, Esc closes and returns focus", () => {
    renderBadge(coach);
    const button = screen.getByRole("button", { name: "Verified professional" });

    keyboardFocus(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    // Enter/Space become a click without a pointer: whoever opened it by focus does not close it.
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    // The popover link is reachable by keyboard without closing.
    const trust = screen.getByRole("link", { name: "How verification works" });
    fireEvent.focusOut(button, { relatedTarget: trust });
    keyboardFocus(trust);
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(trust, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("closes when focus leaves and on a click outside", () => {
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

  it("points to /trust and always warns that course results are not verified", () => {
    renderBadge(coach);
    tap(screen.getByRole("button", { name: "Verified professional" }));

    expect(screen.getByText("We don't verify results or claims made in courses.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How verification works" })).toHaveAttribute("href", "/trust");
  });
});

describe("the text says what was checked and when", () => {
  function statement(verification: ProfessionalVerification, locale = "en") {
    renderBadge(verification, { locale });
    tap(screen.getByRole("button"));
    return document.querySelector("[data-verified-popover]")!.textContent!;
  }

  it("license: the license, with the date in English", () => {
    expect(statement(license)).toContain(
      "SkillsetMind checked this professional license on September 1, 2026.",
    );
  });

  it("evidence: the professional evidence, without promising identity", () => {
    const text = statement(coach);
    expect(text).toContain("SkillsetMind reviewed this person's professional evidence on September 1, 2026.");
    expect(text).not.toMatch(/identity/i);
  });

  it("in Spanish, the date in the local format", () => {
    expect(statement(license, "es")).toContain(
      "SkillsetMind comprobó esta licencia profesional el 1 de septiembre de 2026.",
    );
    cleanup();
    expect(statement(coach, "es")).toContain(
      "SkillsetMind revisó la evidencia profesional de esta persona el 1 de septiembre de 2026.",
    );
    expect(document.body.textContent).not.toMatch(/identidad/i);
  });

  it("approved case without a review date: the sentence without a date, never an invented date", () => {
    const text = statement({ kind: "evidence", verifiedAt: null });
    expect(text).toContain("SkillsetMind reviewed this person's professional evidence.");
    expect(text).not.toMatch(/\bon\b\s*\./);
  });
});

// Legal restriction (US): the badge does not certify, does not endorse, does not accredit.
it.each([
  ["en", en.verifiedBadge, /certif|endors|accredit|licensed by|more students|rank/i],
  ["es", es.verifiedBadge, /certific|avalad|acreditad|licenciad[oa] por|más alumnos|más estudiantes/i],
] as const)("the badge copy in %s does not promise what was not done", (_locale, copy, forbidden) => {
  expect(JSON.stringify(copy)).not.toMatch(forbidden);
});

// /trust and the login strips do not say that everybody is verified.
it.each([
  ["en", en, "Professional verification", /Verified professional/],
  ["es", es, "Verificación profesional", /Profesional verificado/],
] as const)("%s: /trust explains the optional badge and the titles do not promise general verification", (_locale, dict, title, badge) => {
  expect(dict.publicPages.trust.verified_professionals).toBe(title);
  const detail = dict.publicPages.trust.skillsetmind_verifies_professional_eligibility_before_publication;
  expect(detail).toMatch(badge);
  expect(detail).not.toMatch(/identity|identidad|eligibility|elegibilidad/i);
  for (const heading of [dict.auth.page.aside.teacher.point1Title, dict.auth.page.aside.learner.point1Title]) {
    expect(heading).not.toMatch(/^verified|verificad[oa]s$/i);
  }
});
