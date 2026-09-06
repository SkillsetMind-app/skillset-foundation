import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { PublicEntryMenu } from "./public-entry-menu";

const locale = vi.hoisted(() => ({ value: "en" as "en" | "es" }));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => translate(getDictionary(locale.value), key) }),
}));

afterEach(() => { cleanup(); locale.value = "en"; });

describe("public account entry", () => {
  it("opens two role-intent links in separate tabs without changing the current page", () => {
    render(<PublicEntryMenu />);
    expect(screen.queryByRole("link", { name: /My courses/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    for (const [name, intent] of [["My courses", "student"], ["Manage my business", "teacher"]]) {
      const link = screen.getByRole("link", { name: `${name} (opens in a new tab)` });
      expect(link).toHaveAttribute("href", `/auth?mode=signin&path=${intent}`);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("closes on Escape and returns focus to its trigger", () => {
    render(<PublicEntryMenu />);
    const trigger = screen.getByRole("button", { name: "Sign in" });
    fireEvent.click(trigger);
    screen.getByRole("link", { name: /My courses/ }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("link", { name: /My courses/ })).not.toBeInTheDocument();
  });

  it("dismisses on an outside pointer without navigating", () => {
    render(<PublicEntryMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.mouseDown(document.body);
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute("aria-expanded", "false");
  });

  it("updates an already open menu to Spanish without dropping its links", () => {
    const { rerender } = render(<PublicEntryMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    locale.value = "es";
    rerender(<PublicEntryMenu />);
    expect(screen.getByRole("link", { name: "Mis cursos (se abre en una pestaña nueva)" })).toHaveAttribute("href", "/auth?mode=signin&path=student");
    expect(screen.getByRole("link", { name: "Gestionar mi negocio (se abre en una pestaña nueva)" })).toHaveAttribute("href", "/auth?mode=signin&path=teacher");
  });
});
