import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { LocaleSwitcher } from "./locale-switcher";

// The provider's setLocale calls router.refresh(); outside the App Router there is no router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  document.cookie = "skillset.locale.v1=; max-age=0; path=/";
  document.documentElement.lang = "";
});

// A dictionary text next to the selector: proves the choice goes through the
// real I18nProvider (the same path the whole page uses), and not
// through a provider mock.
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
  it("it is a 44px button with its own menu: no <select> in the DOM", () => {
    const trigger = renderSwitcher();
    expect(trigger).toHaveClass("min-h-11", "min-w-11");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.className).not.toMatch(/outline-none/);
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(document.querySelector("select")).toBeNull();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("compact: a discreet abbreviation with no frame, 44px touch target and the same menu", () => {
    const trigger = renderSwitcher({ variant: "compact" });
    expect(trigger).toHaveClass("locale-switcher-compact", "size-11", "bg-transparent", "text-[11px]");
    expect(trigger).not.toHaveClass("border", "bg-[var(--color-surface-soft)]");
    expect(trigger).not.toHaveClass("rounded-full", "min-w-11");
    expect(trigger).toHaveTextContent("EN");
    expect(trigger.querySelector("span")).toHaveClass("text-[11px]", "font-semibold");
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

  it("the header's forced rule excludes the compact variant, including on hover and in dark", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const selectors = css.split("\n").filter(line => /^\s*(?:\[data-theme="dark"\] )?\.platform-topbar__actions > (?:div > )?button/.test(line));
    expect(selectors).toHaveLength(6);
    selectors.forEach(selector => expect(selector).toContain("button:not(.locale-switcher-compact)"));
  });

  it("opens on click, lists both options and marks the current one", () => {
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

  it.each(["ArrowDown", "ArrowUp"])("opens by keyboard with %s on the button", (key) => {
    const trigger = renderSwitcher();
    trigger.focus();
    fireEvent.keyDown(trigger, { key });
    expect(screen.getByRole("listbox", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "English" })).toHaveFocus();
  });

  it("arrows and Home/End move through the list, wrapping at the ends", () => {
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

  it("choosing Español switches the app through the I18nProvider, persists, and goes back to English", () => {
    const trigger = renderSwitcher();
    expect(screen.getByText("Sign in")).toBeInTheDocument();

    // Enter/Space on an option is the native <button> click: the same route.
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

  it("Escape closes and returns focus to the button, without changing the language", () => {
    const trigger = renderSwitcher();
    openMenu(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  it("clicking outside closes, without changing the language", () => {
    const trigger = renderSwitcher();
    openMenu(trigger);
    fireEvent.mouseDown(screen.getByText("fora"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  it("aligns right; in the footer (dropUp) it opens upward", () => {
    const header = openMenu(renderSwitcher());
    expect(header).toHaveClass("right-0", "top-full");
    expect(header).not.toHaveClass("bottom-full");
    cleanup();
    const footer = openMenu(renderSwitcher({ dropUp: true }));
    expect(footer).toHaveClass("right-0", "bottom-full");
    expect(footer).not.toHaveClass("top-full");
  });

  it("has the button label in both dictionaries, on the same path", () => {
    expect(translate(getDictionary("en"), "footer.languageCurrent")).toBe("Language: {language}");
    expect(translate(getDictionary("es"), "footer.languageCurrent")).toBe("Idioma: {language}");
  });
});
