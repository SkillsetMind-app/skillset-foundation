import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Modulo de alerta REAL: so o fetch global e o after() do Next sao falsos, e o
// relay e um endereco inventado (nunca o de verdade).
const RELAY = "https://relay.example.test/hook";

// Por padrao o after() faz o que o Next faz fora do escopo da requisicao:
// lanca. Os testes do caminho "dentro da renderizacao" trocam por um que guarda
// a tarefa, como o Next faz la.
const nextServer = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after: nextServer.after }));

function afterOutsideRequestScope() {
  throw new Error("after was called outside a request scope");
}

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

const REQUEST_CONTEXT = Symbol.for("@next/request-context");
const slots = globalThis as unknown as Record<symbol, unknown>;

function withDigest(message: string, digest: string) {
  return Object.assign(new Error(message), { digest });
}

function sentBody(call: unknown[]) {
  return JSON.parse((call as [string, RequestInit])[1].body as string);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.OPS_ALERT_WEBHOOK_URL = RELAY;
  fetchMock = vi.fn(() => Promise.resolve(new Response("ok")));
  vi.stubGlobal("fetch", fetchMock);
  nextServer.after.mockReset();
  nextServer.after.mockImplementation(afterOutsideRequestScope);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPS_ALERT_WEBHOOK_URL;
  delete slots[REQUEST_CONTEXT];
});

describe("onRequestError", () => {
  // Catch do route handler: o Next AGUARDA o gancho, fora do escopo da
  // requisicao. Enquanto o relay nao respondeu, o gancho segue vivo.
  it("aguardado (route handler): so termina depois que o relay responde", async () => {
    let deliver!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { deliver = resolve; }));
    const onRequestError = await loadFresh();

    let finished = false;
    const pending = Promise.resolve(onRequestError(new Error("boom"), request, context)).then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    deliver(new Response("ok"));
    await pending;
    expect(finished).toBe(true);
  });

  // Erro de renderizacao (RSC/SSR) ou server action: o onError do React chama
  // o gancho e DESCARTA a promessa. O envio tem de ir para o after().
  it("descartado dentro da renderizacao: o envio vai para o after() e chega ao relay", async () => {
    const tasks: unknown[] = [];
    nextServer.after.mockImplementation((task: unknown) => {
      tasks.push(task);
    });
    const onRequestError = await loadFresh();

    void onRequestError(new Error("render"), request, { ...context, routeType: "render" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    const kept = typeof task === "function" ? (task as () => Promise<unknown>)() : task;
    await expect(kept).resolves.toBe(true);
  });

  it("descartado fora do escopo: o mesmo envio vai para o waitUntil da plataforma", async () => {
    const waitUntil = vi.fn();
    slots[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) };
    const onRequestError = await loadFresh();

    void onRequestError(new Error("action"), request, { ...context, routeType: "action" });

    expect(nextServer.after).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledExactlyOnceWith(expect.any(Promise));
    await expect(waitUntil.mock.calls[0][0]).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
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

  // Erro pego por error.tsx, ou lancado num Suspense depois do shell, sai com
  // 200: o texto nao pode prometer "HTTP 500".
  it("o resumo diz rota e tipo, sem status HTTP", async () => {
    const onRequestError = await loadFresh();

    await onRequestError(new Error("x"), request, { ...context, routeType: "render" });

    const { summary, severity } = sentBody(fetchMock.mock.calls[0]);
    expect(summary).toBe("Server error on /courses/[slug] (render).");
    expect(summary).not.toMatch(/500|HTTP/);
    expect(severity).toBe("critical");
  });

  it("usa o digest do Next como impressao digital e corta query que venha na rota", async () => {
    const onRequestError = await loadFresh();

    await onRequestError(withDigest("boom", "2890447281"), request, { ...context, routePath: "/api/checkout?x=1" });

    expect(sentBody(fetchMock.mock.calls[0]).context).toMatchObject({ route: "/api/checkout", fingerprint: "2890447281" });
  });

  it("segura por rota: rotas diferentes avisam, a mesma rota avisa uma vez", async () => {
    const onRequestError = await loadFresh();

    await onRequestError(new Error("a"), request, { ...context, routePath: "/api/checkout" });
    await onRequestError(new Error("b"), request, { ...context, routePath: "/learn/courses/[slug]" });
    await onRequestError(new Error("c"), request, { ...context, routePath: "/api/checkout" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => sentBody(call).context.route)).toEqual(["/api/checkout", "/learn/courses/[slug]"]);
  });

  // Envio que nao chegou ao relay nao pode calar a rota por 5 minutos.
  it("envio perdido devolve a vaga: o proximo erro da rota tenta de novo", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response("fora", { status: 502 })));
    const onRequestError = await loadFresh();

    await onRequestError(new Error("a"), request, context);
    await onRequestError(new Error("b"), request, context);
    await onRequestError(new Error("c"), request, context);

    // 1a perdida, 2a entregue, 3a segurada pelo throttle.
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(nextServer.after).not.toHaveBeenCalled();
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
