import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { PublicEntryMenu } from "./public-entry-menu";

const locale = vi.hoisted(() => ({ value: "en" as "en" | "es" }));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => translate(getDictionary(locale.value), key) }),
}));

afterEach(() => { cleanup(); locale.value = "en"; vi.unstubAllGlobals(); });

// jsdom serve em localhost, que é o caso "fora de produção" dos testes acima.
// Para provar os hosts curtos é preciso fingir o host real; os demais campos
// de location continuam os de verdade para o next/link não estranhar.
function viewFrom(hostname: string) {
  vi.stubGlobal("location", { ...window.location, hostname });
}

describe("public account entry", () => {
  // Mesma aba: para quem tem pouca familiaridade com a internet, aba nova e
  // "o site sumiu". Antes os dois links abriam em aba nova.
  it("opens two role-intent links in the SAME tab", () => {
    render(<PublicEntryMenu />);
    expect(screen.queryByRole("link", { name: /My courses/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    for (const [name, intent] of [["My courses", "student"], ["Manage my business", "teacher"]]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", `/auth?mode=signin&path=${intent}`);
      expect(link).not.toHaveAttribute("target");
    }
  });

  // Em produção cada intenção entra pelo seu host curto. A rota de sign-in e a
  // intenção viajam inteiras na URL, porque o proxy responde 307 preservando
  // caminho e query — o destino final é o mesmo /auth?mode=signin&path=… de sempre.
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

  // Um preview da Vercel nunca manda ninguém para produção: os hosts curtos só
  // resolvem lá, e quem está testando precisa continuar no preview.
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
