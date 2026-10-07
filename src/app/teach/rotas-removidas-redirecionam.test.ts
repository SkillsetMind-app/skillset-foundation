import { describe, expect, it, vi } from "vitest";

import TeacherCouponsPage from "@/app/teach/coupons/page";
import TeacherIntegrationsPage from "@/app/teach/integrations/page";
import TeacherTeamPage from "@/app/teach/team/page";
import { platformNav } from "@/data/site";

// "Collaborators" e "Integrations" eram placas de "em breve" no menu, e
// "Coupons" uma placa dizendo que os cupons ficam em cada produto. Os tres
// sairam do menu; as rotas seguem vivas e levam para a pagina que faz sentido,
// para nenhum link antigo dar 404.

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

describe("itens mortos do menu do professor", () => {
  it.each([
    ["/teach/team", TeacherTeamPage, "/teach"],
    ["/teach/integrations", TeacherIntegrationsPage, "/account/payments"],
    ["/teach/coupons", TeacherCouponsPage, "/teach/builder"],
  ] as const)("%s redireciona para %s", (_route, Page, destination) => {
    expect(() => Page()).toThrow(`REDIRECT:${destination}`);
  });

  it("nenhum deles aparece mais na barra", () => {
    const hrefs = platformNav.filter((item) => item.contexts.length > 0).map((item) => item.href);

    expect(hrefs).not.toContain("/teach/team");
    expect(hrefs).not.toContain("/teach/integrations");
    expect(hrefs).not.toContain("/teach/coupons");
  });
});
