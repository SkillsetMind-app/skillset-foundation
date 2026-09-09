import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CustomDomainsPanel } from "@/components/teacher/custom-domains-panel";
import { domainRejectionMessage, parseCustomDomain } from "@/domain/custom-domain";
import type { CustomDomainStatus, DomainRejection } from "@/domain/custom-domain";

const navigation = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation.router }));

type DomainFixture = {
  id: string;
  hostname: string;
  status: CustomDomainStatus;
  verification_name: string | null;
  verification_value: string | null;
  error_reason: string | null;
};

const domains: DomainFixture[] = [
  {
    id: "dom-1",
    hostname: "aulas.exemplo.com",
    status: "pending_dns",
    verification_name: null,
    verification_value: null,
    error_reason: null,
  },
  {
    id: "dom-2",
    hostname: "live.exemplo.com",
    status: "active",
    verification_name: null,
    verification_value: null,
    error_reason: null,
  },
  {
    id: "dom-3",
    hostname: "erro.exemplo.com",
    status: "error",
    verification_name: null,
    verification_value: null,
    error_reason: "The record points somewhere else.",
  },
];

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function domainPayload(
  rows: DomainFixture[] = [],
  quota = { used: rows.length, limit: 3 },
  configured = true,
) {
  return { domains: rows, quota, configured };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function LanguageControls() {
  const { setLocale } = useTranslation();
  return <>
    <button type="button" onClick={() => setLocale("en")}>Use EN</button>
    <button type="button" onClick={() => setLocale("es")}>Use ES</button>
  </>;
}

function renderWithLocale(locale: "en" | "es" = "en") {
  return render(<I18nProvider initialLocale={locale}>
    <LanguageControls />
    <CustomDomainsPanel />
  </I18nProvider>);
}

async function changeLocale(locale: "en" | "es") {
  fireEvent.click(screen.getByRole("button", { name: `Use ${locale.toUpperCase()}` }));
  // O efeito de carga agenda um timer de 0 ms. Deixá-lo executar faz a
  // contagem detectar uma reinscrição indevida causada pela troca de idioma.
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

function requestCount(method = "GET") {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method).length;
}

function domainCard(hostname: string) {
  const card = screen.getByText(hostname).parentElement?.parentElement;
  if (!card) throw new Error(`Missing card for fixture ${hostname}`);
  return within(card);
}

describe("CustomDomainsPanel", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    navigation.router.refresh.mockReset();
    fetchMock.mockImplementation(async () =>
      jsonResponse({ domains, quota: { used: 3, limit: 3 }, configured: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // P-26: o painel pintava o status com bg-amber-100/bg-emerald-100/bg-red-100 —
  // paleta crua que não acompanha o tema escuro e usa um vocabulário que
  // nenhuma outra tela do estúdio usa. O chip da casa já resolvia tudo isso.
  it("usa o StatusChip da casa para o status de cada domínio", async () => {
    const { container } = render(<CustomDomainsPanel />);

    await screen.findByText("aulas.exemplo.com");

    const pending = container.querySelector('[data-status="pending_dns"]');
    expect(pending).toHaveClass("status-chip", "status-chip--warning");
    expect(pending).toHaveTextContent("Waiting for DNS");
    expect(container.querySelector('[data-status="active"]')).toHaveClass(
      "status-chip--success",
    );
    expect(container.querySelector('[data-status="error"]')).toHaveClass(
      "status-chip--danger",
    );
    expect(container.innerHTML).not.toMatch(/bg-(amber|emerald|red)-\d{2,3}/);
  });

  // P-07: "Disconnect" derrubava o domínio em um clique, sem confirmação, a
  // 8px do "Check again" que o professor martela enquanto o DNS propaga.
  it("pede confirmação antes de desconectar o domínio", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<CustomDomainsPanel />);
    await screen.findByText("aulas.exemplo.com");

    const [disconnect] = screen.getAllByRole("button", { name: /Disconnect/ });
    fireEvent.click(disconnect);

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("aulas.exemplo.com"));
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "DELETE" }),
    );

    confirmSpy.mockReturnValue(true);
    fireEvent.click(disconnect);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/teach/domains/dom-1", {
        method: "DELETE",
      });
    });
  });

  it("veste Disconnect como ação de perigo, não como gêmeo do Check again", async () => {
    render(<CustomDomainsPanel />);
    await screen.findByText("aulas.exemplo.com");

    const [disconnect] = screen.getAllByRole("button", { name: /Disconnect/ });
    const [recheck] = screen.getAllByRole("button", { name: /Check again/ });
    expect(disconnect).toHaveClass("button-danger");
    expect(recheck).toHaveClass("button-outline");
  });

  it.each(["en", "es"] as const)("apresenta os quatro estados em %s e troca idioma sem recarregar os dados", async (locale) => {
    const verification: DomainFixture = {
      ...domains[0], id: "dom-txt", hostname: "verify.example.com", status: "pending_verification",
      verification_name: "_vercel", verification_value: "local-qa-txt",
    };
    fetchMock.mockResolvedValue(jsonResponse(domainPayload(
      [domains[0], verification, domains[1], domains[2]], { used: 4, limit: 6 },
    )));
    renderWithLocale(locale);
    await screen.findByText(domains[0].hostname);

    const labels = {
      en: ["Waiting for DNS", "Waiting for verification", "Live", "Problem"],
      es: ["Esperando DNS", "Esperando verificación", "Activo", "Problema"],
    };
    const hostnames = [domains[0].hostname, verification.hostname, domains[1].hostname, domains[2].hostname];
    for (const nextLocale of [locale, locale === "en" ? "es" : "en"] as const) {
      await changeLocale(nextLocale);
      expect(screen.getByRole("heading", {
        name: nextLocale === "es" ? "Tu propio dominio" : "Your own domain",
      })).toBeInTheDocument();
      hostnames.forEach((hostname, index) => {
        expect(domainCard(hostname).getByText(labels[nextLocale][index])).toBeInTheDocument();
      });
      expect(screen.getByText(nextLocale === "es" ? "4 de 6 utilizados" : "4 of 6 used")).toBeInTheDocument();
      expect(domainCard(domains[1].hostname).queryByRole("button", {
        name: /Check again|Comprobar de nuevo/,
      })).not.toBeInTheDocument();
      expect(domainCard(domains[1].hostname).queryByRole("button", { name: /Copy|Copiar/ })).not.toBeInTheDocument();
      expect(requestCount()).toBe(1);
    }
    expect(domainCard(domains[0].hostname).getByText(locale === "en"
      ? "Añade los registros DNS de abajo en tu registrador. Los cambios de DNS pueden tardar hasta 48 horas en propagarse."
      : "Add the DNS records below at your registrar. DNS changes can take up to 48 hours to reach everyone.")).toBeInTheDocument();
    expect(domainCard(verification.hostname).getByText(locale === "en"
      ? "Añade el registro TXT de abajo para demostrar que el dominio te pertenece y vuelve a comprobarlo."
      : "Add the TXT record below to prove you own this domain, then check again.")).toBeInTheDocument();
    expect(requestCount("POST")).toBe(0);
    expect(requestCount("DELETE")).toBe(0);
  });

  it.each([
    {
      name: "serviço não configurado", payload: domainPayload([], { used: 0, limit: 0 }, false), form: "absent",
      en: "Custom domains are not switched on yet. Nothing is wrong with your account — check back shortly.",
      es: "Los dominios propios todavía no están activados. No hay ningún problema con tu cuenta; vuelve a consultar pronto.",
    },
    {
      name: "plano sem domínio", payload: domainPayload([], { used: 0, limit: 0 }), form: "absent",
      en: "Your plan does not include a custom domain. Upgrade to Starter to connect one.",
      es: "Tu plan no incluye un dominio propio. Mejora a Starter para conectar uno.",
    },
    {
      name: "quota cheia", payload: domainPayload(domains.slice(0, 2), { used: 2, limit: 2 }), form: "disabled",
      en: "You have connected every domain your plan includes. Upgrade to add another.",
      es: "Ya has conectado todos los dominios incluidos en tu plan. Mejora tu plan para añadir otro.",
    },
    {
      name: "quota disponível sem domínios", payload: domainPayload([], { used: 0, limit: 3 }), form: "enabled",
      en: "0 of 3 used", es: "0 de 3 utilizados",
    },
  ])("distingue $name em EN/ES sem mudar quota ou habilitar ação proibida", async (scenario) => {
    fetchMock.mockResolvedValue(jsonResponse(scenario.payload));
    renderWithLocale();
    await screen.findByText(scenario.en);
    await waitFor(() => expect(requestCount()).toBe(1));
    for (const locale of ["en", "es"] as const) {
      await changeLocale(locale);
      expect(screen.getByText(scenario[locale])).toBeInTheDocument();
      const input = screen.queryByRole("textbox", { name: locale === "es" ? "Añadir un dominio" : "Add a domain" });
      if (scenario.form === "absent") {
        expect(input).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^(Connect|Conectar)$/ })).not.toBeInTheDocument();
      } else {
        expect(input).toBeInTheDocument();
        if (scenario.form === "disabled") expect(input).toBeDisabled();
        else expect(input).toBeEnabled();
        expect(screen.getByRole("button", { name: locale === "es" ? "Conectar" : "Connect" })).toBeDisabled();
      }
      expect(requestCount()).toBe(1);
    }
    expect(requestCount("POST")).toBe(0);
    expect(requestCount("DELETE")).toBe(0);
  });

  // Quota desconhecida não é quota zero. Começar em EN isola essa falha da tradução.
  it.each(["HTTP", "rede"] as const)("mantém a carga pendente e o erro de GET (%s) distintos de plano sem domínio", async (failure) => {
    const pending = deferredResponse();
    fetchMock.mockReturnValue(pending.promise);
    renderWithLocale();
    await waitFor(() => expect(requestCount()).toBe(1));
    expect(screen.getByText("Loading your domains…")).toBeInTheDocument();
    expect(screen.queryByText(/Your plan does not include a custom domain/)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await changeLocale("es");
    expect(screen.getByText("Cargando tus dominios…")).toBeInTheDocument();
    expect(requestCount()).toBe(1);
    await act(async () => {
      if (failure === "HTTP") pending.resolve(jsonResponse({ error: "local-qa-load-failure" }, 503));
      else pending.reject(new Error("local-qa-network-failure"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar tus dominios.");
    expect(screen.queryByText(/Tu plan no incluye|0 de 0/)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await changeLocale("en");
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your domains.");
    expect(screen.queryByText(/Your plan does not include|0 of 0/)).not.toBeInTheDocument();
    expect(requestCount()).toBe(1);
    expect(requestCount("POST")).toBe(0);
    expect(requestCount("DELETE")).toBe(0);
  });

  it("permite repetir a carga inicial após falha e anuncia a tentativa sem GET extra ao trocar idioma", async () => {
    const retry = deferredResponse();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "local-qa-load-failure" }, 503));
    fetchMock.mockReturnValueOnce(retry.promise);
    renderWithLocale();
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load your domains.");
    await changeLocale("es");
    expect(screen.getByRole("button", { name: "Intentar de nuevo" })).toBeEnabled();
    expect(requestCount()).toBe(1);
    await changeLocale("en");
    const retryButton = screen.getByRole("button", { name: "Try again" });
    retryButton.focus();
    fireEvent.click(retryButton);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your domains…");
    expect(screen.getByRole("status").closest("section")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBe(retryButton);
    expect(retryButton).toHaveFocus();
    expect(retryButton).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(requestCount()).toBe(2);
    await changeLocale("es");
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tus dominios…");
    expect(requestCount()).toBe(2);
    await act(async () => retry.resolve(jsonResponse(domainPayload([domains[1]]))));
    expect(await screen.findByText(domains[1].hostname)).toBeInTheDocument();
    expect(screen.getByText("1 de 3 utilizados")).toBeInTheDocument();
    const hostname = screen.getByRole("textbox", { name: "Añadir un dominio" });
    expect(hostname).toBeEnabled();
    expect(hostname.closest("section")).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await changeLocale("en");
    expect(screen.getByText("1 of 3 used")).toBeInTheDocument();
    expect(requestCount()).toBe(2);
    expect(requestCount("POST")).toBe(0);
    expect(requestCount("DELETE")).toBe(0);
  });

  it.each([
    { reason: "empty", input: "   ", es: "Introduce un dominio, por ejemplo tunombre.com" },
    { reason: "too_long", input: `${"a".repeat(60)}.`.repeat(5) + "com", es: "Ese dominio es demasiado largo para ser válido." },
    { reason: "has_scheme_or_path", input: "mysite.com/cursos", es: "Introduce solo el dominio: tunombre.com, no una dirección web completa con una ruta." },
    { reason: "non_ascii", input: "café.com", es: "Introduce el dominio en formato ASCII. Si tiene acentos o caracteres no latinos, tu registrador muestra una versión que empieza por xn--." },
    { reason: "malformed", input: "192.168.0.1", es: "Eso no parece un dominio. Ejemplo: tunombre.com" },
    { reason: "single_label", input: "mysite", es: "Incluye la terminación, por ejemplo tunombre.com en lugar de tunombre" },
    { reason: "reserved", input: "anything.skillsetmind.com", es: "Ese dominio pertenece a la plataforma y no se puede registrar." },
  ] satisfies Array<{ reason: DomainRejection; input: string; es: string }>)("recusa $reason antes de POST e retraduz o erro associado sem perder o texto", async ({ reason, input, es }) => {
    fetchMock.mockResolvedValue(jsonResponse(domainPayload()));
    renderWithLocale();
    const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
    expect(parseCustomDomain(input)).toEqual({ ok: false, reason });
    fireEvent.change(hostname, { target: { value: input } });
    // O envio direto também cobre a guarda de vazio, mesmo com o botão desabilitado.
    fireEvent.submit(screen.getByRole("button", { name: "Connect" }).closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent(domainRejectionMessage[reason]);
    expect(hostname).toHaveAttribute("aria-invalid", "true");
    expect(hostname).toHaveAccessibleDescription(domainRejectionMessage[reason]);
    await changeLocale("es");
    expect(screen.getByRole("alert")).toHaveTextContent(es);
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toHaveValue(input);
    expect(hostname).toHaveAccessibleDescription(es);
    expect(requestCount()).toBe(1);
    expect(requestCount("POST")).toBe(0);
  });

  it("mantém hostname e busy durante EN↔ES e envia apenas o domínio normalizado", async () => {
    const addition = deferredResponse();
    const saved: DomainFixture = { ...domains[0], id: "dom-new", hostname: "miescuela.example.com" };
    fetchMock.mockResolvedValue(jsonResponse(domainPayload([saved])));
    fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload()));
    fetchMock.mockReturnValueOnce(addition.promise);
    renderWithLocale();
    const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
    const draft = "  HTTPS://MiEscuela.Example.COM./  ";
    fireEvent.change(hostname, { target: { value: draft } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/teach/domains", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "miescuela.example.com" }),
    });
    for (const locale of ["es", "en", "es"] as const) {
      await changeLocale(locale);
      const label = locale === "es" ? "Añadir un dominio" : "Add a domain";
      expect(screen.getByRole("textbox", { name: label })).toHaveValue(draft);
      expect(screen.getByRole("textbox", { name: label })).toBeDisabled();
      expect(screen.getByRole("button", { name: locale === "es" ? "Conectar" : "Connect" })).toBeDisabled();
      expect(requestCount()).toBe(1);
      expect(requestCount("POST")).toBe(1);
    }
    await act(async () => addition.resolve(jsonResponse({ id: saved.id, status: saved.status }, 201)));
    await screen.findByText(saved.hostname);
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toBeEnabled();
    expect(screen.getByText("1 de 3 utilizados")).toBeInTheDocument();
    expect(requestCount()).toBe(2);
    expect(requestCount("POST")).toBe(1);
  });

  it.each([
    { status: 401, body: { error: "You must be signed in." }, en: "You must be signed in.", es: "Debes iniciar sesión." },
    { status: 503, body: { error: "Custom domains are not available yet. Support has been notified." }, en: "Custom domains are not available yet. Support has been notified.", es: "Los dominios propios todavía no están disponibles. Se ha avisado a soporte." },
    { status: 403, body: { error: "You have used every domain your plan includes. Upgrade to add another." }, en: "You have used every domain your plan includes. Upgrade to add another.", es: "Has utilizado todos los dominios incluidos en tu plan. Mejora tu plan para añadir otro." },
    { status: 403, body: { error: "Custom domains are not included on your plan." }, en: "Custom domains are not included on your plan.", es: "Tu plan no incluye dominios propios." },
    { status: 409, body: { error: "That domain is already connected." }, en: "That domain is already connected.", es: "Ese dominio ya está conectado." },
    { status: 400, body: { error: "Invalid request body." }, en: "Could not add that domain.", es: "No pudimos añadir ese dominio." },
    { status: 403, body: { error: "local-qa-unknown-permission-error" }, en: "Could not add that domain.", es: "No pudimos añadir ese dominio." },
    { status: 502, body: { status: "error", errorReason: "That domain is already connected somewhere else." }, en: "That domain is already connected somewhere else.", es: "Ese dominio ya está conectado en otro lugar." },
  ])("localiza erro de conexão HTTP $status ($en), preserva rascunho e não infere plano pelo status", async ({ status, body, en, es }) => {
    fetchMock.mockResolvedValue(jsonResponse(domainPayload()));
    fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload()));
    fetchMock.mockResolvedValueOnce(jsonResponse(body, status));
    renderWithLocale();
    const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
    fireEvent.change(hostname, { target: { value: "draft.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en);
    expect(hostname).toHaveValue("draft.example.com");
    expect(hostname).toBeEnabled();
    await changeLocale("es");
    expect(screen.getByRole("alert")).toHaveTextContent(es);
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toHaveValue("draft.example.com");
    expect(screen.queryByText("local-qa-unknown-permission-error")).not.toBeInTheDocument();
    expect(screen.queryByText("Invalid request body.")).not.toBeInTheDocument();
    expect(requestCount()).toBe(1);
    expect(requestCount("POST")).toBe(1);
  });

  it("mostra erro de rede no idioma atual quando a conexão termina após a troca", async () => {
    const addition = deferredResponse();
    fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload()));
    fetchMock.mockReturnValueOnce(addition.promise);
    renderWithLocale();
    fireEvent.change(await screen.findByRole("textbox", { name: "Add a domain" }), { target: { value: "draft.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await changeLocale("es");
    await act(async () => addition.reject(new Error("local-qa-provider-unreachable")));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos añadir ese dominio.");
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toHaveValue("draft.example.com");
    expect(screen.getByRole("button", { name: "Conectar" })).toBeEnabled();
    await changeLocale("en");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not add that domain.");
    expect(requestCount()).toBe(1);
    expect(requestCount("POST")).toBe(1);
  });

  it.each([
    {
      type: "A", row: { ...domains[0], hostname: "example.com" },
      name: "@", value: "216.198.79.1",
    },
    {
      type: "CNAME", row: { ...domains[0], hostname: "learn.example.com" },
      name: "learn", value: "cname.vercel-dns.com",
    },
    {
      type: "TXT", row: {
        ...domains[0], hostname: "verify.example.com", status: "pending_verification" as const,
        verification_name: "_vercel.local-qa", verification_value: "local-qa-proof=$$;$&;literal",
      },
      name: "_vercel.local-qa", value: "local-qa-proof=$$;$&;literal",
    },
  ])("traduz o nome acessível da cópia de $type sem alterar um caractere dos dados DNS", async ({ row, type, name, value }) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    fetchMock.mockResolvedValue(jsonResponse(domainPayload([row])));
    renderWithLocale("es");
    await screen.findByText(row.hostname);
    for (const locale of ["es", "en"] as const) {
      await changeLocale(locale);
      const card = domainCard(row.hostname);
      const labels = locale === "es" ? ["Tipo", "Nombre", "Valor"] : ["Type", "Name", "Value"];
      const values = [type, name, value];
      for (let index = 0; index < values.length; index++) {
        expect(card.getByText(values[index], { selector: "code" })).toBeInTheDocument();
        await act(async () => {
          fireEvent.click(card.getByRole("button", {
            name: `${locale === "es" ? "Copiar" : "Copy"} ${labels[index]}`,
          }));
        });
        expect(writeText).toHaveBeenLastCalledWith(values[index]);
        expect(card.getAllByRole("status").map((status) => status.textContent))
          .toContain(locale === "es" ? "Valor copiado." : "Value copied.");
      }
      expect(requestCount()).toBe(1);
    }
    expect(writeText).toHaveBeenCalledTimes(6);
    expect(requestCount("POST")).toBe(0);
    expect(requestCount("DELETE")).toBe(0);
  });

  it.each([
    { reason: "That domain is already connected somewhere else.", en: "That domain is already connected somewhere else.", es: "Ese dominio ya está conectado en otro lugar." },
    { reason: "Too many domain changes right now. Try again in a few minutes.", en: "Too many domain changes right now. Try again in a few minutes.", es: "Hay demasiados cambios de dominio en este momento. Inténtalo de nuevo en unos minutos." },
    { reason: "The platform could not reach the domain provider. Support has been notified.", en: "The platform could not reach the domain provider. Support has been notified.", es: "La plataforma no pudo contactar con el proveedor de dominios. Se ha avisado a soporte." },
    { reason: "The domain could not be set up. Check the spelling and try again.", en: "The domain could not be set up. Check the spelling and try again.", es: "No se pudo configurar el dominio. Comprueba la escritura e inténtalo de nuevo." },
    { reason: "local-qa-unknown-provider-detail", en: "The domain could not be set up. Check the spelling and try again.", es: "No se pudo configurar el dominio. Comprueba la escritura e inténtalo de nuevo." },
  ])("apresenta motivo de erro do domínio com tradução e fallback ($reason)", async ({ reason, en, es }) => {
    const row = { ...domains[2], error_reason: reason };
    fetchMock.mockResolvedValue(jsonResponse(domainPayload([row])));
    renderWithLocale("es");
    await screen.findByText(row.hostname);
    expect(domainCard(row.hostname).getByText(es)).toBeInTheDocument();
    expect(domainCard(row.hostname).getByText("Hubo un problema con este dominio. Elimínalo y añádelo de nuevo, o contacta con soporte.")).toBeInTheDocument();
    expect(screen.queryByText("local-qa-unknown-provider-detail")).not.toBeInTheDocument();
    await changeLocale("en");
    expect(domainCard(row.hostname).getByText(en)).toBeInTheDocument();
    expect(requestCount()).toBe(1);
    expect(requestCount("POST")).toBe(0);
    expect(requestCount("DELETE")).toBe(0);
  });

  // CourseShareLink já anuncia a recusa e conserva o dado para cópia manual.
  it("anuncia recusa do clipboard em EN/ES, conserva o TXT literal e permite tentar novamente", async () => {
    const value = "LOCAL QA $$ $& TXT that must remain available";
    const writeText = vi.fn().mockResolvedValue(undefined)
      .mockRejectedValueOnce(new DOMException("LOCAL QA clipboard denied", "NotAllowedError"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const verification: DomainFixture = {
      ...domains[0], status: "pending_verification", verification_name: "_vercel.local-qa",
      verification_value: value,
    };
    fetchMock.mockResolvedValue(jsonResponse(domainPayload([verification])));
    renderWithLocale();
    fireEvent.change(await screen.findByRole("textbox", { name: "Add a domain" }), {
      target: { value: "draft.local-qa.example" },
    });
    fireEvent.click(domainCard(verification.hostname).getByRole("button", { name: "Copy Value" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy. Copy the value above manually.");
    expect(domainCard(verification.hostname).getByText(value, { selector: "code" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenLastCalledWith(value);
    await changeLocale("es");
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo copiar. Copia el valor de arriba manualmente.");
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toHaveValue("draft.local-qa.example");
    expect(writeText).toHaveBeenCalledTimes(1);
    fireEvent.click(domainCard(verification.hostname).getByRole("button", { name: "Copiar Valor" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenLastCalledWith(value);
    expect(domainCard(verification.hostname).getByText(value, { selector: "code" })).toBeInTheDocument();
    expect(requestCount()).toBe(1);
    expect(requestCount("POST")).toBe(0);
    expect(requestCount("DELETE")).toBe(0);
  });

  it("preserva contexto ao cancelar e mantém desconexão ocupada durante EN↔ES sem DELETE duplicado", async () => {
    const removal = deferredResponse();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fetchMock.mockResolvedValue(jsonResponse(domainPayload([domains[1]])));
    fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload(domains.slice(0, 2))));
    fetchMock.mockReturnValueOnce(removal.promise);
    renderWithLocale("es");
    const hostname = await screen.findByRole("textbox", { name: "Añadir un dominio" });
    fireEvent.change(hostname, { target: { value: "draft.example.com" } });
    fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: "Desconectar" }));
    expect(confirmSpy).toHaveBeenLastCalledWith(
      `¿Desconectar ${domains[0].hostname}? Los estudiantes volverán a la dirección de la plataforma y tendrás que configurar el DNS de nuevo si lo reconectas.`,
    );
    expect(requestCount("DELETE")).toBe(0);
    expect(hostname).toHaveValue("draft.example.com");
    expect(domainCard(domains[0].hostname).getByRole("button", { name: "Comprobar de nuevo" })).toBeEnabled();

    await changeLocale("en");
    confirmSpy.mockReturnValue(true);
    fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: "Disconnect" }));
    expect(confirmSpy).toHaveBeenLastCalledWith(
      `Disconnect ${domains[0].hostname}? Students go back to the platform address, and the DNS setup starts over if you reconnect it.`,
    );
    expect(fetchMock).toHaveBeenCalledWith(`/api/teach/domains/${domains[0].id}`, { method: "DELETE" });
    await changeLocale("es");
    expect(domainCard(domains[0].hostname).getByRole("button", { name: "Desconectar" })).toBeDisabled();
    expect(domainCard(domains[0].hostname).getByRole("button", { name: "Comprobar de nuevo" })).toBeDisabled();
    expect(domainCard(domains[1].hostname).getByRole("button", { name: "Desconectar" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toHaveValue("draft.example.com");
    expect(requestCount()).toBe(1);
    expect(requestCount("DELETE")).toBe(1);
    await act(async () => removal.resolve(jsonResponse({ ok: true, hostname: domains[0].hostname })));
    await waitFor(() => expect(screen.queryByText(domains[0].hostname)).not.toBeInTheDocument());
    expect(screen.getByText(domains[1].hostname)).toBeInTheDocument();
    expect(screen.getByText("1 de 3 utilizados")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toHaveValue("draft.example.com");
    expect(requestCount()).toBe(2);
    expect(requestCount("DELETE")).toBe(1);
  });

  it("preserva rascunho e busy na nova verificação e apresenta o status retornado no idioma atual", async () => {
    const recheck = deferredResponse();
    fetchMock.mockResolvedValue(jsonResponse(domainPayload([{ ...domains[0], status: "active" }])));
    fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload([domains[0]])));
    fetchMock.mockReturnValueOnce(recheck.promise);
    renderWithLocale();
    fireEvent.change(await screen.findByRole("textbox", { name: "Add a domain" }), { target: { value: "draft.example.com" } });
    fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: "Check again" }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/teach/domains/${domains[0].id}`, { method: "POST" });
    await changeLocale("es");
    expect(domainCard(domains[0].hostname).getByRole("button", { name: "Comprobar de nuevo" })).toBeDisabled();
    expect(domainCard(domains[0].hostname).getByRole("button", { name: "Desconectar" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toHaveValue("draft.example.com");
    expect(requestCount()).toBe(1);
    expect(requestCount("POST")).toBe(1);
    await act(async () => recheck.resolve(jsonResponse({ status: "active" })));
    expect(await screen.findByText("Activo")).toBeInTheDocument();
    expect(domainCard(domains[0].hostname).queryByRole("button", { name: "Comprobar de nuevo" })).not.toBeInTheDocument();
    expect(domainCard(domains[0].hostname).getByRole("button", { name: "Desconectar" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toHaveValue("draft.example.com");
    expect(requestCount()).toBe(2);
    expect(requestCount("POST")).toBe(1);
  });

  // A API retorna erro HTTP sem lançar. Uma recarga bem-sucedida não torna a mutação bem-sucedida.
  it.each([
    { method: "POST", action: "Check again", status: 404, body: { error: "Domain not found." }, en: "Domain not found.", es: "No se encontró el dominio." },
    { method: "POST", action: "Check again", status: 403, body: { error: "local-qa-unknown-recheck-error" }, en: "Could not check that domain again.", es: "No pudimos volver a comprobar ese dominio." },
    { method: "DELETE", action: "Disconnect", status: 400, body: { error: "Could not remove that domain." }, en: "Could not remove that domain.", es: "No pudimos desconectar ese dominio." },
    { method: "DELETE", action: "Disconnect", status: 403, body: { error: "local-qa-unknown-remove-error" }, en: "Could not remove that domain.", es: "No pudimos desconectar ese dominio." },
  ])("não apresenta sucesso falso em $method HTTP $status e conserva contexto ao trocar idioma", async ({ method, action, status, body, en, es }) => {
    const mutation = deferredResponse();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockResolvedValue(jsonResponse(domainPayload([domains[0]])));
    fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload([domains[0]])));
    fetchMock.mockReturnValueOnce(mutation.promise);
    renderWithLocale();
    const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
    fireEvent.change(hostname, { target: { value: "draft.example.com" } });
    fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: action }));
    expect(domainCard(domains[0].hostname).getByRole("button", { name: action })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith(`/api/teach/domains/${domains[0].id}`, { method });
    await act(async () => mutation.resolve(jsonResponse(body, status)));
    expect(await screen.findByRole("alert")).toHaveTextContent(en);
    await waitFor(() => expect(requestCount()).toBe(status === 404 ? 2 : 1));
    expect(domainCard(domains[0].hostname).getByText("Waiting for DNS")).toBeInTheDocument();
    expect(domainCard(domains[0].hostname).getByRole("button", { name: action })).toBeEnabled();
    expect(hostname).toHaveValue("draft.example.com");
    expect(screen.getByText("1 of 3 used")).toBeInTheDocument();
    const readsAfterFailure = requestCount();
    await changeLocale("es");
    expect(screen.getByRole("alert")).toHaveTextContent(es);
    expect(domainCard(domains[0].hostname).getByText("Esperando DNS")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toHaveValue("draft.example.com");
    expect(screen.getByText("1 de 3 utilizados")).toBeInTheDocument();
    expect(screen.queryByText(/local-qa-unknown-(recheck|remove)-error/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tu plan no incluye|Your plan does not include/)).not.toBeInTheDocument();
    expect(requestCount()).toBe(readsAfterFailure);
    expect(requestCount(method)).toBe(1);
  });

  it.each([
    { method: "POST", action: "Check again" },
    { method: "DELETE", action: "Disconnect" },
  ])("reconcilia $method 404 com quota cheia sem anunciar sucesso da operação", async ({ method, action }) => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload([domains[0]], { used: 1, limit: 1 })));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Domain not found." }, 404));
    fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload([], { used: 0, limit: 1 })));
    renderWithLocale();
    const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
    expect(hostname).toBeDisabled();
    expect(hostname).toHaveValue("");
    fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: action }));
    await waitFor(() => expect(requestCount()).toBe(2));
    await waitFor(() => expect(screen.queryByText(domains[0].hostname)).not.toBeInTheDocument());
    expect(screen.getByText("0 of 1 used")).toBeInTheDocument();
    expect(hostname).toBeEnabled();
    expect(hostname).toHaveValue("");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.change(hostname, { target: { value: "new.example.com" } });
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
    await changeLocale("es");
    expect(screen.getByText("0 de 1 utilizados")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Añadir un dominio" })).toHaveValue("new.example.com");
    expect(screen.getByRole("button", { name: "Conectar" })).toBeEnabled();
    expect(requestCount()).toBe(2);
    expect(requestCount(method)).toBe(1);
  });

  it.each([
    { method: "POST", action: "Check again", en: "Could not check that domain again.", es: "No pudimos volver a comprobar ese dominio." },
    { method: "DELETE", action: "Disconnect", en: "Could not remove that domain.", es: "No pudimos desconectar ese dominio." },
  ])("associa a recusa de $method ao cartão acionado, preservando o campo de adicionar válido em EN/ES", async ({ method, action, en, es }) => {
    const mutation = deferredResponse();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload(domains.slice(0, 2))));
    fetchMock.mockReturnValueOnce(mutation.promise);
    renderWithLocale();
    const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
    fireEvent.change(hostname, { target: { value: "draft.example.com" } });
    fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: action }));
    await act(async () => mutation.resolve(jsonResponse({ error: "local-qa-action-refused" }, 403)));
    expect(domainCard(domains[0].hostname).getByRole("alert")).toHaveTextContent(en);
    for (const locale of ["en", "es"] as const) {
      await changeLocale(locale);
      expect(domainCard(domains[0].hostname).getByRole("alert")).toHaveTextContent(locale === "es" ? es : en);
      expect(domainCard(domains[1].hostname).queryByRole("alert")).not.toBeInTheDocument();
      const input = screen.getByRole("textbox", { name: locale === "es" ? "Añadir un dominio" : "Add a domain" });
      expect(input).toHaveValue("draft.example.com");
      expect(input).not.toHaveAttribute("aria-invalid", "true");
      expect(input).not.toHaveAccessibleDescription();
      expect(input).toBeEnabled();
      expect(requestCount()).toBe(1);
      expect(requestCount(method)).toBe(1);
    }
  });

  describe("atualização da lista após resposta de domínio", () => {
    const refreshCopy = {
      en: "Could not refresh domains. The list may be out of date.",
      es: "No pudimos actualizar los dominios. La lista puede estar desactualizada.",
    };
    type Mutation = { url: string; method: "POST" | "DELETE"; body?: string };

    function expectDomainTraffic(reads: number, writes: Mutation[]) {
      const calls = fetchMock.mock.calls.map(([url, init]) => ({
        url,
        method: init?.method ?? "GET",
        body: init?.body ?? null,
      }));
      expect(calls.filter((call) => call.method === "GET"))
        .toEqual(Array.from({ length: reads }, () => ({ url: "/api/teach/domains", method: "GET", body: null })));
      expect(calls.filter((call) => call.method !== "GET"))
        .toEqual(writes.map((write) => ({ ...write, body: write.body ?? null })));
    }

    it.each(([
      { operation: "add", method: "POST", action: "Connect" },
      { operation: "recheck", method: "POST", action: "Check again" },
      { operation: "remove", method: "DELETE", action: "Disconnect" },
    ] as const).flatMap((scenario) => (["HTTP", "rede"] as const).map((failure) => ({ ...scenario, failure }))))(
      "recupera GET com falha $failure após $operation aceito sem repetir a mutação em EN↔ES",
      async ({ operation, method, action, failure }) => {
        const mutation = deferredResponse();
        const failedRead = deferredResponse();
        const retry = deferredResponse();
        const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
        const verificationValue = "TXT literal $$ $& {hostname} local-qa";
        const target: DomainFixture = {
          ...domains[0], status: "pending_verification",
          verification_name: "_verify.aulas.exemplo.com", verification_value: verificationValue,
        };
        const saved: DomainFixture = { ...domains[0], id: "dom-new", hostname: "miescuela.example.com" };
        const updated: DomainFixture = {
          ...target, status: "error", verification_name: null, verification_value: null,
          error_reason: "The domain could not be set up. Check the spelling and try again.",
        };
        const finalRows = operation === "add" ? [target, domains[1], saved]
          : operation === "remove" ? [domains[1]] : [updated, domains[1]];
        const write: Mutation = operation === "add"
          ? { url: "/api/teach/domains", method, body: JSON.stringify({ hostname: saved.hostname }) }
          : { url: `/api/teach/domains/${target.id}`, method };
        fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload([target, domains[1]])));
        fetchMock.mockReturnValueOnce(mutation.promise);
        fetchMock.mockReturnValueOnce(failedRead.promise);
        fetchMock.mockReturnValueOnce(retry.promise);
        renderWithLocale();
        const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
        const form = hostname.closest("form")!;
        const draft = operation === "add" ? "  HTTPS://MiEscuela.Example.COM./  " : "draft.local-qa.example";
        const retainedDraft = operation === "add" ? "" : draft;
        expect(hostname).toBeEnabled();
        fireEvent.change(hostname, { target: { value: draft } });
        fireEvent.click(operation === "add"
          ? screen.getByRole("button", { name: action })
          : domainCard(target.hostname).getByRole("button", { name: action }));
        expectDomainTraffic(1, [write]);
        const accepted = operation === "add" ? saved
          : operation === "remove" ? { ok: true, hostname: target.hostname }
            : { id: target.id, status: "error", errorReason: updated.error_reason };
        await act(async () => mutation.resolve(jsonResponse(accepted, operation === "add" ? 201 : 200)));
        await waitFor(() => expect(requestCount()).toBe(2));
        expect(hostname).toHaveValue(retainedDraft);
        await act(async () => {
          if (failure === "HTTP") failedRead.resolve(jsonResponse({ error: "local-qa-read-refused" }, 503));
          else failedRead.reject(new Error("local-qa-read-unreachable"));
        });
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(refreshCopy.en);
        expect(form).not.toContainElement(alert);

        for (const locale of ["en", "es"] as const) {
          await changeLocale(locale);
          expect(screen.getByRole("alert")).toHaveTextContent(refreshCopy[locale]);
          expect(within(form).queryByRole("alert")).not.toBeInTheDocument();
          expect(hostname).toHaveValue(retainedDraft);
          expect(hostname).not.toHaveAttribute("aria-invalid", "true");
          expect(hostname).not.toHaveAccessibleDescription();
          expect(screen.getByText(locale === "es" ? "2 de 3 utilizados" : "2 of 3 used")).toBeInTheDocument();
          expect(domainCard(target.hostname).getByText(locale === "es" ? "Esperando verificación" : "Waiting for verification")).toBeInTheDocument();
          expect(domainCard(target.hostname).getByText(verificationValue, { selector: "code" })).toBeInTheDocument();
          expect(domainCard(target.hostname).queryByRole("alert")).not.toBeInTheDocument();
          expect(screen.queryByText(saved.hostname)).not.toBeInTheDocument();
          expect(screen.queryByText(/local-qa-read-(refused|unreachable)/)).not.toBeInTheDocument();
          expectDomainTraffic(2, [write]);
        }

        fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
        await waitFor(() => expect(requestCount()).toBe(3));
        for (const locale of ["en", "es"] as const) {
          await changeLocale(locale);
          expect(screen.getByRole("status")).toHaveTextContent(locale === "es" ? "Cargando tus dominios…" : "Loading your domains…");
          expect(hostname.closest("section")).toHaveAttribute("aria-busy", "true");
          expect(screen.getByRole("textbox", { name: locale === "es" ? "Añadir un dominio" : "Add a domain" })).toBe(hostname);
          expect(hostname).toHaveValue(retainedDraft);
          expect(screen.getByText(locale === "es" ? "2 de 3 utilizados" : "2 of 3 used")).toBeInTheDocument();
          expect(domainCard(target.hostname).getByText(verificationValue, { selector: "code" })).toBeInTheDocument();
          const retryButton = screen.getByRole("button", { name: locale === "es" ? "Intentar de nuevo" : "Try again" });
          expect(retryButton).toHaveAttribute("aria-disabled", "true");
          fireEvent.click(retryButton);
          expectDomainTraffic(3, [write]);
        }
        await act(async () => retry.resolve(jsonResponse(domainPayload(finalRows))));
        await waitFor(() => expect(hostname.closest("section")).toHaveAttribute("aria-busy", "false"));
        for (const locale of ["en", "es"] as const) {
          await changeLocale(locale);
          expect(screen.queryByRole("alert")).not.toBeInTheDocument();
          expect(hostname).toHaveValue(retainedDraft);
          expect(hostname).not.toHaveAttribute("aria-invalid", "true");
          expect(screen.getByText(locale === "es" ? `${finalRows.length} de 3 utilizados` : `${finalRows.length} of 3 used`)).toBeInTheDocument();
          if (operation === "add") expect(screen.getByText(saved.hostname)).toBeInTheDocument();
          else if (operation === "remove") expect(screen.queryByText(target.hostname)).not.toBeInTheDocument();
          else expect(domainCard(target.hostname).getByText(locale === "es" ? "Problema" : "Problem")).toBeInTheDocument();
          expectDomainTraffic(3, [write]);
        }
        expect(confirmSpy).toHaveBeenCalledTimes(operation === "remove" ? 1 : 0);
      },
    );

    it.each(["en", "es"] as const)("preserva foco do Retry na espera e falha em %s e devolve contexto após sucesso", async (locale) => {
      const failedRetry = deferredResponse();
      const finalRetry = deferredResponse();
      const write: Mutation = { url: `/api/teach/domains/${domains[0].id}`, method: "POST" };
      fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload([domains[0]])));
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: "active" }));
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
      fetchMock.mockReturnValueOnce(failedRetry.promise);
      fetchMock.mockReturnValueOnce(finalRetry.promise);
      renderWithLocale(locale);
      const hostname = await screen.findByRole("textbox", { name: locale === "es" ? "Añadir un dominio" : "Add a domain" });
      const panel = hostname.closest("section")!;
      fireEvent.change(hostname, { target: { value: "draft.example.com" } });
      fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: locale === "es" ? "Comprobar de nuevo" : "Check again" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(refreshCopy[locale]);
      const retryName = locale === "es" ? "Intentar de nuevo" : "Try again";
      const retryButton = screen.getByRole("button", { name: retryName });
      retryButton.focus();
      fireEvent.click(retryButton);
      expect(screen.getByRole("button", { name: retryName })).toBe(retryButton);
      expect(retryButton).toHaveFocus();
      expect(retryButton).not.toBeDisabled();
      expect(retryButton).toHaveAttribute("aria-disabled", "true");
      expect(panel).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent(locale === "es" ? "Cargando tus dominios…" : "Loading your domains…");
      fireEvent.click(retryButton);
      fireEvent.click(retryButton);
      expectDomainTraffic(3, [write]);

      await act(async () => failedRetry.resolve(jsonResponse({}, 503)));
      expect(await screen.findByRole("alert")).toHaveTextContent(refreshCopy[locale]);
      expect(screen.getByRole("button", { name: retryName })).toBe(retryButton);
      expect(retryButton).toHaveFocus();
      expect(retryButton).toHaveAttribute("aria-disabled", "false");
      expect(panel).toHaveAttribute("aria-busy", "false");
      expect(hostname).toHaveValue("draft.example.com");
      expectDomainTraffic(3, [write]);

      fireEvent.click(retryButton);
      expect(retryButton).toHaveFocus();
      await act(async () => finalRetry.resolve(jsonResponse(domainPayload([{ ...domains[0], status: "active" }]))));
      expect(screen.queryByRole("button", { name: retryName })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(panel).toHaveFocus();
      expect(panel).toHaveAttribute("aria-busy", "false");
      expect(hostname).toHaveValue("draft.example.com");
      expect(domainCard(domains[0].hostname).getByText(locale === "es" ? "Activo" : "Live")).toBeInTheDocument();
      expectDomainTraffic(4, [write]);
    });

    it("preserva foco que saiu do Retry para o rascunho antes de recuperar a leitura", async () => {
      const retry = deferredResponse();
      const write: Mutation = { url: `/api/teach/domains/${domains[0].id}`, method: "POST" };
      fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload([domains[0]])));
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: "active" }));
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
      fetchMock.mockReturnValueOnce(retry.promise);
      renderWithLocale();
      const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
      fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: "Check again" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(refreshCopy.en);
      const retryButton = screen.getByRole("button", { name: "Try again" });
      retryButton.focus();
      fireEvent.click(retryButton);
      hostname.focus();
      fireEvent.change(hostname, { target: { value: "draft.example.com" } });
      await act(async () => retry.resolve(jsonResponse(domainPayload([{ ...domains[0], status: "active" }]))));
      expect(hostname).toHaveFocus();
      expect(hostname).toHaveValue("draft.example.com");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
      expectDomainTraffic(3, [write]);
    });

    it("libera quota cheia somente após o GET de recuperação de DELETE aceito", async () => {
      const retry = deferredResponse();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      const write: Mutation = { url: `/api/teach/domains/${domains[0].id}`, method: "DELETE" };
      fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload([domains[0]], { used: 1, limit: 1 })));
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, hostname: domains[0].hostname }));
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
      fetchMock.mockReturnValueOnce(retry.promise);
      renderWithLocale();
      const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
      expect(hostname).toBeDisabled();
      expect(hostname).toHaveValue("");
      fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: "Disconnect" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(refreshCopy.en);
      expect(hostname).not.toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText("1 of 1 used")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(hostname).toBeDisabled();
      expect(hostname).toHaveValue("");
      expect(screen.getByText(domains[0].hostname)).toBeInTheDocument();
      await act(async () => retry.resolve(jsonResponse(domainPayload([], { used: 0, limit: 1 }))));
      await waitFor(() => expect(hostname).toBeEnabled());
      expect(screen.getByText("0 of 1 used")).toBeInTheDocument();
      expect(screen.queryByText(domains[0].hostname)).not.toBeInTheDocument();
      fireEvent.change(hostname, { target: { value: "next.example.com" } });
      expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
      expectDomainTraffic(3, [write]);
      expect(confirmSpy).toHaveBeenCalledOnce();
    });

    it("mantém snapshot e rascunho quando o retry falha antes da leitura seguinte recuperar", async () => {
      const failedRetry = deferredResponse();
      const finalRetry = deferredResponse();
      const write: Mutation = { url: `/api/teach/domains/${domains[0].id}`, method: "POST" };
      fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload([domains[0]])));
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: "active" }));
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
      fetchMock.mockReturnValueOnce(failedRetry.promise);
      fetchMock.mockReturnValueOnce(finalRetry.promise);
      renderWithLocale();
      const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
      fireEvent.change(hostname, { target: { value: "draft.example.com" } });
      fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: "Check again" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(refreshCopy.en);
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(screen.getByRole("status")).toHaveTextContent("Loading your domains…");
      expectDomainTraffic(3, [write]);
      await act(async () => failedRetry.reject(new Error("local-qa-retry-unreachable")));
      expect(await screen.findByRole("alert")).toHaveTextContent(refreshCopy.en);
      expect(hostname).toHaveValue("draft.example.com");
      expect(hostname).not.toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText("1 of 3 used")).toBeInTheDocument();
      expect(domainCard(domains[0].hostname).getByText("Waiting for DNS")).toBeInTheDocument();
      await changeLocale("es");
      expect(screen.getByRole("alert")).toHaveTextContent(refreshCopy.es);
      expectDomainTraffic(3, [write]);
      fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
      await act(async () => finalRetry.resolve(jsonResponse(domainPayload([{ ...domains[0], status: "active" }]))));
      expect(await screen.findByText("Activo")).toBeInTheDocument();
      expect(hostname).toHaveValue("draft.example.com");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expectDomainTraffic(4, [write]);
    });

    it("limpa só a falha de leitura no retry sem apagar validação legítima de Add", async () => {
      const retry = deferredResponse();
      const write: Mutation = { url: `/api/teach/domains/${domains[0].id}`, method: "POST" };
      fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload([domains[0]])));
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: "active" }));
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
      fetchMock.mockReturnValueOnce(retry.promise);
      renderWithLocale();
      const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
      const form = hostname.closest("form")!;
      fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: "Check again" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(refreshCopy.en);
      fireEvent.change(hostname, { target: { value: "localhost" } });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(within(form).getByRole("alert")).toHaveTextContent(domainRejectionMessage.single_label);
      expect(screen.getByText(refreshCopy.en)).toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(2);
      expect(hostname).toHaveAttribute("aria-invalid", "true");
      expectDomainTraffic(2, [write]);
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await act(async () => retry.resolve(jsonResponse(domainPayload([{ ...domains[0], status: "active" }]))));
      await screen.findByText("Live");
      expect(screen.queryByText(refreshCopy.en)).not.toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(within(form).getByRole("alert")).toHaveTextContent(domainRejectionMessage.single_label);
      expect(hostname).toHaveAccessibleDescription(domainRejectionMessage.single_label);
      expect(hostname).toHaveValue("localhost");
      await changeLocale("es");
      expect(within(form).getByRole("alert")).toHaveTextContent("Incluye la terminación, por ejemplo tunombre.com en lugar de tunombre");
      expect(hostname).toHaveAttribute("aria-invalid", "true");
      expect(hostname).toHaveValue("localhost");
      expectDomainTraffic(3, [write]);
    });

    it.each([
      { method: "POST", action: "Check again" },
      { method: "DELETE", action: "Disconnect" },
    ] as const)("recupera a leitura após $method 404 sem sucesso ou mutação repetida", async ({ method, action }) => {
      const retry = deferredResponse();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      const write: Mutation = { url: `/api/teach/domains/${domains[0].id}`, method };
      fetchMock.mockResolvedValueOnce(jsonResponse(domainPayload([domains[0]], { used: 1, limit: 1 })));
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Domain not found." }, 404));
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
      fetchMock.mockReturnValueOnce(retry.promise);
      renderWithLocale();
      const hostname = await screen.findByRole("textbox", { name: "Add a domain" });
      const form = hostname.closest("form")!;
      expect(hostname).toBeDisabled();
      fireEvent.click(domainCard(domains[0].hostname).getByRole("button", { name: action }));
      await screen.findByText(refreshCopy.en);
      for (const locale of ["en", "es"] as const) {
        await changeLocale(locale);
        expect(domainCard(domains[0].hostname).getByRole("alert")).toHaveTextContent(locale === "es" ? "No se encontró el dominio." : "Domain not found.");
        expect(screen.getByText(refreshCopy[locale])).toBeInTheDocument();
        expect(screen.getAllByRole("alert")).toHaveLength(2);
        expect(within(form).queryByRole("alert")).not.toBeInTheDocument();
        expect(hostname).not.toHaveAttribute("aria-invalid", "true");
        expect(hostname).toBeDisabled();
        expect(hostname).toHaveValue("");
        expectDomainTraffic(2, [write]);
      }
      fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
      await act(async () => retry.resolve(jsonResponse(domainPayload([], { used: 0, limit: 1 }))));
      await waitFor(() => expect(screen.queryByText(domains[0].hostname)).not.toBeInTheDocument());
      expect(screen.getByText("0 de 1 utilizados")).toBeInTheDocument();
      expect(hostname).toBeEnabled();
      expect(hostname).toHaveValue("");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expectDomainTraffic(3, [write]);
      expect(confirmSpy).toHaveBeenCalledTimes(method === "DELETE" ? 1 : 0);
    });
  });
});
