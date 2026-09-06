import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LocaleSwitcher } from "./locale-switcher";

const state = vi.hoisted(() => ({ locale: "en", setLocale: vi.fn() }));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ ...state, t: () => state.locale === "es" ? "Idioma" : "Language" }),
}));
beforeEach(() => { state.locale = "en"; state.setLocale.mockClear(); });

it.each(["en", "es"])("offers one native selector with the current %s locale", (locale) => {
  state.locale = locale;
  render(<LocaleSwitcher />);
  const selector = screen.getByRole("combobox", { name: locale === "es" ? "Idioma" : "Language" });
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(selector).toHaveValue(locale);
  expect(screen.getByRole("option", { name: "English" })).toHaveValue("en");
  expect(screen.getByRole("option", { name: "Español" })).toHaveValue("es");
  const next = locale === "en" ? "es" : "en";
  fireEvent.change(selector, { target: { value: next } });
  expect(state.setLocale).toHaveBeenCalledExactlyOnceWith(next);
});
