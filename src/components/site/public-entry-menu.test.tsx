import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { PublicEntryMenu } from "./public-entry-menu";

const locale = vi.hoisted(() => ({ value: "en" as "en" | "es" }));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => translate(getDictionary(locale.value), key) }),
}));

afterEach(() => { cleanup(); locale.value = "en"; vi.unstubAllGlobals(); });

// jsdom serves on localhost, which is the "outside production" case of the tests above.
// To prove the short hosts we have to fake the real host; the other fields
// of location stay real so next/link is not surprised.
function viewFrom(hostname: string) {
  vi.stubGlobal("location", { ...window.location, hostname });
}

describe("public account entry", () => {
  // Same tab: for people with little familiarity with the internet, a new tab is
  // "the site disappeared". The two links used to open in a new tab.
  it("opens two role-intent links in the SAME tab", () => {
    render(<PublicEntryMenu />);
    expect(screen.queryByRole("link", { name: /My courses/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    for (const [name, intent] of [["My courses", "student"], ["Manage my business", "teacher"]]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", `/auth?mode=signin&path=${intent}`);
      expect(link).not.toHaveAttribute("target");
    }
    // It enters like the platform menus, instead of a hard cut.
    expect(screen.getByRole("link", { name: "My courses" }).parentElement).toHaveClass("motion-drop-in");
  });

  // In production each intent enters through its own short host. The sign-in route and the
  // intent travel whole in the URL, because the proxy answers 307 preserving
  // path and query — the final destination is the same /auth?mode=signin&path=… as always.
  it.each(["www.skillsetmind.com", "skillsetmind.com"])(
    "enters through consumer. and app. when viewed from %s, keeping intent in the same tab",
    (hostname) => {
      viewFrom(hostname);
      render(<PublicEntryMenu />);
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      const student = screen.getByRole("link", { name: "My courses" });
      const teacher = screen.getByRole("link", { name: "Manage my business" });
      expect(student).toHaveAttribute("href", "https://consumer.skillsetmind.com/auth?mode=signin&path=student");
      expect(teacher).toHaveAttribute("href", "https://app.skillsetmind.com/auth?mode=signin&path=teacher");
      for (const link of [student, teacher]) {
        expect(link).not.toHaveAttribute("target");
      }
    },
  );

  // A Vercel preview never sends anyone to production: the short hosts only
  // resolve there, and whoever is testing needs to stay on the preview.
  it.each(["skillset-foundation-git-feat-links-skillsetmind.vercel.app", "localhost"])(
    "keeps both links relative when viewed from %s",
    (hostname) => {
      viewFrom(hostname);
      render(<PublicEntryMenu />);
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      expect(screen.getByRole("link", { name: /My courses/ })).toHaveAttribute("href", "/auth?mode=signin&path=student");
      expect(screen.getByRole("link", { name: /Manage my business/ })).toHaveAttribute("href", "/auth?mode=signin&path=teacher");
    },
  );

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
    expect(screen.getByRole("link", { name: "Mis cursos" })).toHaveAttribute("href", "/auth?mode=signin&path=student");
    expect(screen.getByRole("link", { name: "Gestionar mi negocio" })).toHaveAttribute("href", "/auth?mode=signin&path=teacher");
  });
});
