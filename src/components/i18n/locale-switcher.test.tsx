import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { LocaleSwitcher } from "./locale-switcher";

// setLocale do provider chama router.refresh(); fora do App Router não há router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  document.cookie = "skillset.locale.v1=; max-age=0; path=/";
  document.documentElement.lang = "";
});

// Um texto do dicionário ao lado do seletor: prova que a escolha passa pelo
// I18nProvider de verdade (o mesmo caminho que a página inteira usa), e não
// por um mock do provider.
function Probe() {
  const { t } = useTranslation();
  return <p>{t("nav.signIn")}</p>;
}

function renderSwitcher(props: { dropUp?: boolean; variant?: "default" | "compact" } = {}) {
  render(
    <I18nProvider initialLocale="en">
      <a href="#fora">fora</a>
      <LocaleSwitcher {...props} />
      <Probe />
    </I18nProvider>,
  );
  return screen.getByRole("button", { name: "Language: English" });
}

function openMenu(trigger: HTMLElement) {
  fireEvent.click(trigger);
  return screen.getByRole("listbox", { name: "Language" });
}

describe("LocaleSwitcher", () => {
  it("é um botão de 44px com menu próprio: nenhum <select> no DOM", () => {
    const trigger = renderSwitcher();
    expect(trigger).toHaveClass("min-h-11", "min-w-11");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.className).not.toMatch(/outline-none/);
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(document.querySelector("select")).toBeNull();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("compacto: sigla discreta sem moldura, alvo de toque de 44px e mesmo menu", () => {
    const trigger = renderSwitcher({ variant: "compact" });
    expect(trigger).toHaveClass("locale-switcher-compact", "size-11", "bg-transparent", "text-[11px]");
    expect(trigger).not.toHaveClass("border", "bg-[var(--color-surface-soft)]");
    expect(trigger).not.toHaveClass("rounded-full", "min-w-11");
    expect(trigger).toHaveTextContent("EN");
    expect(trigger.querySelector("svg")).toBeNull();
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger.className).not.toMatch(/outline-none/);

    const menu = openMenu(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(menu).toHaveClass("right-0", "top-full");
    expect(within(menu).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "English",
      "Español",
    ]);
  });

  it("a regra forcada do cabecalho exclui a variante compacta inclusive em hover e dark", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const selectors = css.split("\n").filter(line => /^\s*(?:\[data-theme="dark"\] )?\.platform-topbar__actions > (?:div > )?button/.test(line));
    expect(selectors).toHaveLength(6);
    selectors.forEach(selector => expect(selector).toContain("button:not(.locale-switcher-compact)"));
  });

  it("abre com clique, lista as duas opções e marca a atual", () => {
    const trigger = renderSwitcher();
    const menu = openMenu(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    const options = within(menu).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["English", "Español"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("lang", "es");
    expect(options[0]).toHaveFocus();
    expect(document.querySelector("select")).toBeNull();
  });

  it.each(["ArrowDown", "ArrowUp"])("abre pelo teclado com %s no botão", (key) => {
    const trigger = renderSwitcher();
    trigger.focus();
    fireEvent.keyDown(trigger, { key });
    expect(screen.getByRole("listbox", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "English" })).toHaveFocus();
  });

  it("setas e Home/End andam pela lista, com volta nas pontas", () => {
    const menu = openMenu(renderSwitcher());
    const [english, spanish] = within(menu).getAllByRole("option");
    fireEvent.keyDown(english, { key: "ArrowDown" });
    expect(spanish).toHaveFocus();
    fireEvent.keyDown(spanish, { key: "ArrowDown" });
    expect(english).toHaveFocus();
    fireEvent.keyDown(english, { key: "ArrowUp" });
    expect(spanish).toHaveFocus();
    fireEvent.keyDown(spanish, { key: "Home" });
    expect(english).toHaveFocus();
    fireEvent.keyDown(english, { key: "End" });
    expect(spanish).toHaveFocus();
  });

  it("escolher Español troca o app pelo I18nProvider, persiste, e volta para English", () => {
    const trigger = renderSwitcher();
    expect(screen.getByText("Sign in")).toBeInTheDocument();

    // Enter/Espaço numa opção é o clique nativo do <button>: a mesma rota.
    fireEvent.click(within(openMenu(trigger)).getByRole("option", { name: "Español" }));

    expect(screen.getByText("Iniciar sesión")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const spanishTrigger = screen.getByRole("button", { name: "Idioma: Español" });
    expect(spanishTrigger).toHaveFocus();
    expect(spanishTrigger).toHaveAttribute("aria-expanded", "false");
    expect(document.cookie).toContain("skillset.locale.v1=es");
    expect(document.documentElement.lang).toBe("es");

    fireEvent.click(spanishTrigger);
    const menu = screen.getByRole("listbox", { name: "Idioma" });
    expect(within(menu).getByRole("option", { name: "Español" })).toHaveAttribute("aria-selected", "true");
    expect(within(menu).getByRole("option", { name: "English" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(within(menu).getByRole("option", { name: "English" }));

    expect(screen.getByText("Sign in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Language: English" })).toHaveFocus();
    expect(document.cookie).toContain("skillset.locale.v1=en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("Escape fecha e devolve o foco ao botão, sem trocar o idioma", () => {
    const trigger = renderSwitcher();
    openMenu(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  it("clique fora fecha, sem trocar o idioma", () => {
    const trigger = renderSwitcher();
    openMenu(trigger);
    fireEvent.mouseDown(screen.getByText("fora"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  it("alinha à direita; no rodapé (dropUp) abre para cima", () => {
    const header = openMenu(renderSwitcher());
    expect(header).toHaveClass("right-0", "top-full");
    expect(header).not.toHaveClass("bottom-full");
    cleanup();
    const footer = openMenu(renderSwitcher({ dropUp: true }));
    expect(footer).toHaveClass("right-0", "bottom-full");
    expect(footer).not.toHaveClass("top-full");
  });

  it("tem o rótulo do botão nos dois dicionários, no mesmo caminho", () => {
    expect(translate(getDictionary("en"), "footer.languageCurrent")).toBe("Language: {language}");
    expect(translate(getDictionary("es"), "footer.languageCurrent")).toBe("Idioma: {language}");
  });
});
