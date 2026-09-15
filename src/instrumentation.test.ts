import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Modulo de alerta REAL: so o fetch global e falso. Mockar o alerta inteiro
// escondia o buraco que importa: num 500 de route handler o after() lanca
// fora do escopo da requisicao e o aviso nunca saia.
const RELAY = "https://relay.example.test/hook";

type Instrumentation = typeof import("@/instrumentation");

async function loadFresh(): Promise<Instrumentation["onRequestError"]> {
  // O throttle por rota vive no modulo: cada caso comeca com o seu.
  vi.resetModules();
  return (await import("@/instrumentation")).onRequestError;
}

// Pedido com tudo o que NUNCA pode sair no aviso: query, e-mail na URL e
// cabecalhos com dado privado. Enderecos inventados usam example.test.
const request = {
  path: "/courses/deep-focus?coupon=PRIVADO&email=pessoa@example.test",
  method: "POST",
  headers: {
    cookie: "sessao=valor-privado",
    "x-user-email": "pessoa@example.test",
    "x-forwarded-for": "203.0.113.9",
  },
};

const context = {
  routerKind: "App Router",
  routePath: "/courses/[slug]",
  routeType: "route",
  revalidateReason: undefined,
} as const;

function withDigest(message: string, digest: string) {
  return Object.assign(new Error(message), { digest });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.OPS_ALERT_WEBHOOK_URL = RELAY;
  fetchMock = vi.fn(() => Promise.resolve(new Response("ok")));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPS_ALERT_WEBHOOK_URL;
});

describe("onRequestError", () => {
  it("aguarda o envio ao relay antes de terminar", async () => {
    let deliver!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { deliver = resolve; }));
    const onRequestError = await loadFresh();

    let finished = false;
    const pending = Promise.resolve(onRequestError(new Error("boom"), request, context)).then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // O Next espera este gancho: enquanto o relay nao respondeu, ele segue vivo.
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    deliver(new Response("ok"));
    await pending;
    expect(finished).toBe(true);
  });

  it("manda so rota, tipo, metodo, nome do erro e impressao digital", async () => {
    const onRequestError = await loadFresh();

    await onRequestError(new TypeError("falhou para pessoa@example.test no pedido 123"), request, context);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RELAY);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ event: "app.server_error", severity: "critical" });
    expect(body.context).toEqual({
      route: "/courses/[slug]",
      routeType: "route",
      method: "POST",
      errorName: "TypeError",
      fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/),
    });

    // Nem no corpo nem nos cabecalhos do envio.
    const sent = JSON.stringify(init);
    for (const leak of ["coupon", "PRIVADO", "pessoa@example.test", "deep-focus", "falhou", "123", "valor-privado", "203.0.113.9"]) {
      expect(sent).not.toContain(leak);
    }
  });

  it("usa o digest do Next como impressao digital e corta query que venha na rota", async () => {
    const onRequestError = await loadFresh();

    await onRequestError(withDigest("boom", "2890447281"), request, { ...context, routePath: "/api/checkout?x=1" });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.context).toMatchObject({ route: "/api/checkout", fingerprint: "2890447281" });
  });

  it("segura por rota: rotas diferentes avisam, a mesma rota avisa uma vez", async () => {
    const onRequestError = await loadFresh();

    await onRequestError(new Error("a"), request, { ...context, routePath: "/api/checkout" });
    await onRequestError(new Error("b"), request, { ...context, routePath: "/learn/courses/[slug]" });
    await onRequestError(new Error("c"), request, { ...context, routePath: "/api/checkout" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const routes = fetchMock.mock.calls.map((call) => JSON.parse((call as [string, RequestInit])[1].body as string).context.route);
    expect(routes).toEqual(["/api/checkout", "/learn/courses/[slug]"]);
  });

  it.each([
    ["notFound", withDigest("NEXT_HTTP_ERROR_FALLBACK;404", "NEXT_HTTP_ERROR_FALLBACK;404")],
    ["redirect", withDigest("NEXT_REDIRECT", "NEXT_REDIRECT;replace;/entrar;307;")],
    ["pedido abortado", Object.assign(new Error("aborted"), { name: "AbortError" })],
    ["conexao fechada", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })],
  ])("%s nao manda aviso", async (_case, error) => {
    const onRequestError = await loadFresh();

    await onRequestError(error, request, context);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relay fora do ar nao lanca", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("relay fora")));
    const onRequestError = await loadFresh();

    await expect(onRequestError(new Error("a"), request, context)).resolves.toBeUndefined();
  });

  it("um erro que volte ao gancho durante o envio, pela mesma rota, nao reenvia", async () => {
    const onRequestError = await loadFresh();
    fetchMock.mockImplementationOnce(async () => {
      await onRequestError(new Error("dentro do envio"), request, context);
      return new Response("ok");
    });

    await onRequestError(new Error("fora"), request, context);

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
