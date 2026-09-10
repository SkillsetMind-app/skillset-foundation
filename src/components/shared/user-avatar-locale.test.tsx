import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { UserAvatar } from "./user-avatar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

function LanguageButton() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("en")}>EN</button>;
}

it("localizes the real image name without interpreting user text as a replacement pattern", () => {
  render(<I18nProvider initialLocale="es"><LanguageButton /><UserAvatar name="Ana $&" photoURL="https://example.com/avatar.jpg" /></I18nProvider>);
  const image = screen.getByRole("img", { name: "Foto de perfil de Ana $&" });
  fireEvent.click(screen.getByRole("button", { name: "EN" }));
  expect(image).toHaveAttribute("alt", "Ana $&'s profile picture");
});

it("localizes the unnamed fallback without inventing a user identity", () => {
  render(<I18nProvider initialLocale="es"><UserAvatar /></I18nProvider>);
  expect(screen.getByLabelText("Foto de perfil")).toBeVisible();
});
