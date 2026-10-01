import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// setLocale do provider chama router.refresh(); fora do App Router não há router.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  document.cookie = "skillset.locale.v1=; max-age=0; path=/";
  document.documentElement.lang = "";
});

// O setup do vitest já deixa o espanhol na memória. Aqui o registro volta ao
// estado do navegador: só o inglês, e o resto vem por import() sob demanda.
async function freshProvider() {
  vi.resetModules();
  const provider = await import("./i18n-provider");
  const translate = await import("@/lib/i18n/translate");
  return { ...provider, ...translate };
}

it("o bundle compartilhado só tem o inglês; o espanhol chega sob demanda", async () => {
  const { I18nProvider, useTranslation, getLoadedDictionary } = await freshProvider();
  expect(getLoadedDictionary("en")).toBeDefined();
  expect(getLoadedDictionary("es")).toBeUndefined();

  function Probe() {
    const { locale, setLocale, t } = useTranslation();
    return <button type="button" onClick={() => setLocale("es")}>{`${locale}:${t("nav.signIn")}`}</button>;
  }
  render(<I18nProvider initialLocale="en"><Probe /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "en:Sign in" }));

  // Troca atômica: idioma e textos juntos, depois do chunk.
  expect(await screen.findByRole("button", { name: "es:Iniciar sesión" })).toBeInTheDocument();
  expect(document.cookie).toContain("skillset.locale.v1=es");
  expect(document.documentElement.lang).toBe("es");
  expect(refresh).toHaveBeenCalled();
  expect(getLoadedDictionary("es")).toBeDefined();
});

it("com o dicionário mandado pelo servidor, o primeiro render já sai em espanhol", async () => {
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
