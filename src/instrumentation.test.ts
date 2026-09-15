import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const ops = vi.hoisted(() => ({ notifyOps: vi.fn() }));

vi.mock("@/lib/ops/alert", () => ({ notifyOps: ops.notifyOps }));

const { onRequestError } = await import("@/instrumentation");

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
  routeType: "render",
  renderSource: "server-rendering",
  revalidateReason: undefined,
} as const;

function withDigest(message: string, digest: string) {
  return Object.assign(new Error(message), { digest });
}

let consoleError: MockInstance;

beforeEach(() => {
  ops.notifyOps.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("onRequestError", () => {
  it("erro inesperado avisa o ops uma vez, so com rota, tipo, metodo, nome e impressao digital", () => {
    const error = new TypeError("falhou para pessoa@example.test no pedido 123");

    const result = onRequestError(error, request, context);

    // Sincrono: nao devolve promessa, entao nao segura a resposta.
    expect(result).toBeUndefined();
    expect(ops.notifyOps).toHaveBeenCalledOnce();
    const alert = ops.notifyOps.mock.calls[0][0];
    expect(alert).toMatchObject({ event: "app.server_error", severity: "critical" });
    expect(alert.context).toEqual({
      route: "/courses/[slug]",
      routeType: "render",
      method: "POST",
      errorName: "TypeError",
      fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/),
    });

    const sent = JSON.stringify(alert);
    for (const leak of ["coupon", "PRIVADO", "pessoa@example.test", "deep-focus", "falhou", "123", "valor-privado", "203.0.113.9"]) {
      expect(sent).not.toContain(leak);
    }
    // O log do Vercel continua recebendo o erro inteiro.
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("usa o digest do Next como impressao digital e corta query que venha na rota", () => {
    onRequestError(withDigest("boom", "2890447281"), request, {
      ...context,
      routePath: "/api/checkout?x=1",
      routeType: "route",
    });

    expect(ops.notifyOps.mock.calls[0][0].context).toMatchObject({
      route: "/api/checkout",
      routeType: "route",
      fingerprint: "2890447281",
    });
  });

  it.each([
    ["notFound", withDigest("NEXT_HTTP_ERROR_FALLBACK;404", "NEXT_HTTP_ERROR_FALLBACK;404")],
    ["redirect", withDigest("NEXT_REDIRECT", "NEXT_REDIRECT;replace;/entrar;307;")],
    ["pedido abortado", Object.assign(new Error("aborted"), { name: "AbortError" })],
    ["conexao fechada", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })],
  ])("%s nao manda aviso", (_case, error) => {
    onRequestError(error, request, context);

    expect(ops.notifyOps).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("falha no aviso nunca lanca, e o proximo erro ainda avisa", () => {
    ops.notifyOps.mockImplementationOnce(() => {
      throw new Error("relay fora");
    });

    expect(() => onRequestError(new Error("a"), request, context)).not.toThrow();
    onRequestError(new Error("b"), request, context);

    expect(ops.notifyOps).toHaveBeenCalledTimes(2);
  });

  it("um erro disparado de dentro do aviso nao reentra", () => {
    ops.notifyOps.mockImplementationOnce(() => {
      onRequestError(new Error("dentro do aviso"), request, context);
    });

    onRequestError(new Error("fora"), request, context);

    expect(ops.notifyOps).toHaveBeenCalledOnce();
  });
});
