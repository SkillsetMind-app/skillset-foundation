import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// The provider's setLocale calls router.refresh(); outside the App Router there is no router.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  document.cookie = "skillset.locale.v1=; max-age=0; path=/";
  document.documentElement.lang = "";
});

// The vitest setup already leaves Spanish in memory. Here the registry goes back to the
// browser's state: only English, and the rest comes through import() on demand.
async function freshProvider() {
  vi.resetModules();
  const provider = await import("./i18n-provider");
  const translate = await import("@/lib/i18n/translate");
  return { ...provider, ...translate };
}

it("the shared bundle only has English; Spanish arrives on demand", async () => {
  const { I18nProvider, useTranslation, getLoadedDictionary } = await freshProvider();
  expect(getLoadedDictionary("en")).toBeDefined();
  expect(getLoadedDictionary("es")).toBeUndefined();

  function Probe() {
    const { locale, setLocale, t } = useTranslation();
    return <button type="button" onClick={() => setLocale("es")}>{`${locale}:${t("nav.signIn")}`}</button>;
  }
  render(<I18nProvider initialLocale="en"><Probe /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "en:Sign in" }));

  // Atomic switch: language and texts together, after the chunk.
  expect(await screen.findByRole("button", { name: "es:Iniciar sesión" })).toBeInTheDocument();
  expect(document.cookie).toContain("skillset.locale.v1=es");
  expect(document.documentElement.lang).toBe("es");
  expect(refresh).toHaveBeenCalled();
  expect(getLoadedDictionary("es")).toBeDefined();
});

it("with the dictionary sent by the server, the first render is already in Spanish", async () => {
  const { I18nProvider, useTranslation, getLoadedDictionary } = await freshProvider();
  const es = (await import("@/data/i18n/es.json")).default;
  expect(getLoadedDictionary("es")).toBeUndefined();

  function Probe() {
    const { t } = useTranslation();
    return <p>{t("nav.signIn")}</p>;
  }
  render(<I18nProvider initialLocale="es" initialDictionary={es}><Probe /></I18nProvider>);
  expect(screen.getByText("Iniciar sesión")).toBeInTheDocument();
});
