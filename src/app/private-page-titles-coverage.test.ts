import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// O que a pessoa sofria: as páginas atrás de login (/account, /learn, /teach)
// não têm título próprio — a aba do navegador mostra o título genérico do
// site. Cada página passou a exportar `generateMetadata` chamando
// `privatePageMetadata(chave)` com a MESMA chave que ela já usa em
// `PlatformShell title={t(chave)}`. Este teste é estático (lê o texto-fonte,
// não renderiza nem chama generateMetadata): confere que a lista de páginas
// cobertas é exatamente a que existe no disco, que a chave do helper bate com
// a do cabeçalho, e que a chave existe nos dois dicionários.
const PAGINAS_COM_TITULO_PROPRIO = [
  "account/billing/page.tsx",
  "account/billing/return/page.tsx",
  "account/billing/upgrade/page.tsx",
  "account/notifications/page.tsx",
  "account/page.tsx",
  "account/payments/page.tsx",
  "account/plans/page.tsx",
  "learn/community/page.tsx",
  "learn/credentials/page.tsx",
  "learn/events/page.tsx",
  "learn/messages/page.tsx",
  "learn/page.tsx",
  "learn/wishlist/page.tsx",
  "teach/activate/page.tsx",
  "teach/activate/return/page.tsx",
  "teach/builder/page.tsx",
  "teach/coupons/page.tsx",
  "teach/courses/[courseId]/community/page.tsx",
  "teach/courses/[courseId]/manage/page.tsx",
  "teach/events/page.tsx",
  "teach/integrations/page.tsx",
  "teach/marketing/page.tsx",
  "teach/media/page.tsx",
  "teach/members/page.tsx",
  "teach/messages/page.tsx",
  "teach/page.tsx",
  "teach/reports/page.tsx",
  "teach/sales/[orderId]/page.tsx",
  "teach/sales/page.tsx",
  "teach/storefront/page.tsx",
  "teach/subscriptions/page.tsx",
  "teach/team/page.tsx",
  "teach/verification/page.tsx",
] as const;

function readPage(relPath: string): string {
  return readFileSync(`src/app/${relPath}`, "utf8");
}

/** Todo page.tsx sob account/, learn/, teach/ cujo texto-fonte chama privatePageMetadata(...). */
function pagesWithPrivateMetadataOnDisk(): string[] {
  const sections = ["account", "learn", "teach"];
  const relPaths = sections.flatMap((section) =>
    (readdirSync(`src/app/${section}`, { recursive: true }) as string[])
      .filter((entry) => entry.endsWith("page.tsx"))
      .map((entry) => `${section}/${entry.replace(/\\/g, "/")}`),
  );
  return relPaths.filter((relPath) => readPage(relPath).includes("privatePageMetadata("));
}

describe("título da aba das páginas logadas", () => {
  it("a lista de páginas cobertas é exatamente a que existe no disco (não encolhe sem querer)", () => {
    expect(pagesWithPrivateMetadataOnDisk().sort()).toEqual(
      [...PAGINAS_COM_TITULO_PROPRIO].sort(),
    );
  });

  it.each(PAGINAS_COM_TITULO_PROPRIO)(
    "%s: a chave do helper é a mesma do cabeçalho e existe em en/es",
    (relPath) => {
      const source = readPage(relPath);

      const helperMatch = source.match(/privatePageMetadata\(\s*"([^"]+)"\s*\)/);
      expect(helperMatch, `generateMetadata via privatePageMetadata() ausente em ${relPath}`).not.toBeNull();
      const helperKey = helperMatch![1];

      const shellMatch = source.match(/PlatformShell[\s\S]*?\btitle=\{t\("([^"]+)"\)\}/);
      expect(shellMatch, `PlatformShell title={t(...)} ausente em ${relPath}`).not.toBeNull();
      const shellKey = shellMatch![1];

      expect(helperKey, `chave do helper diverge do cabeçalho em ${relPath}`).toBe(shellKey);

      // translate() cai para en e, se também faltar lá, devolve a própria
      // chave — então "!== chave" prova que ao menos o en.json tem a entrada.
      // A paridade en/es em si é responsabilidade de dictionary-parity.test.ts.
      expect(translate(getDictionary("en"), helperKey), `chave ausente: ${helperKey}`).not.toBe(helperKey);
      expect(translate(getDictionary("es"), helperKey), `chave ausente: ${helperKey}`).not.toBe(helperKey);
    },
  );
});
