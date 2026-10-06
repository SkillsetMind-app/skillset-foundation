// @vitest-environment node
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { describe, expect, it } from "vitest";

import nextConfig from "../../../../next.config";

// `/@usuario` não pode ser pasta (no App Router, @ é slot de rota paralela):
// é um rewrite do next.config para a página de perfil. Mesmo matcher e mesmo
// montador de destino que o Next usa.
async function rewriteOf(pathname: string): Promise<string | null> {
  const rewrites = await nextConfig.rewrites!();
  const list = Array.isArray(rewrites)
    ? rewrites
    : [...(rewrites.beforeFiles ?? []), ...(rewrites.afterFiles ?? []), ...(rewrites.fallback ?? [])];
  for (const rule of list) {
    const params = getPathMatch(rule.source)(pathname);
    if (params) {
      return prepareDestination({ appendParamsToQuery: false, destination: rule.destination, params, query: {} }).newUrl;
    }
  }
  return null;
}

describe("/@usuario", () => {
  it("serve a página de perfil sem mudar a URL", async () => {
    expect(await rewriteOf("/@ana.souza")).toBe("/instructors/@ana.souza");
    expect(await rewriteOf("/@ana_souza-2")).toBe("/instructors/@ana_souza-2");
  });

  it("não engole outras rotas nem subcaminhos", async () => {
    for (const path of ["/courses", "/instructors/abc", "/ana", "/@ana/extra", "/@"]) {
      expect(await rewriteOf(path), path).toBeNull();
    }
  });
});
