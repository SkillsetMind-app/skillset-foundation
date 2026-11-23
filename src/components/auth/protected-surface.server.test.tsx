// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { SidebarPreferenceProvider } from "@/lib/ui/sidebar-preference";

// A espera da guarda é o HTML que o servidor manda para as 39 páginas
// protegidas (a sessão está em "loading" no servidor). Aqui não há window nem
// document: se a espera os lesse ao renderizar, isto quebrava, e no navegador
// seria uma divergência de hidratação.
const mocks = vi.hoisted(() => ({ pathname: "/teach/sales" }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "loading", user: null }),
}));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

function serverHtml(pathname: string, pref: "collapsed" | "expanded" | null) {
  mocks.pathname = pathname;
  return renderToString(
    <SidebarPreferenceProvider value={pref}>
      <ProtectedSurface permissions={["teacherStudio.access"]}>
        <p>conteudo protegido</p>
      </ProtectedSurface>
    </SidebarPreferenceProvider>,
  );
}

describe("ProtectedSurface no servidor", () => {
  it("roda sem window nem document", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("a casca sai com a barra que o layout leu do cookie, um aviso só", () => {
    const collapsed = serverHtml("/teach/sales", "collapsed");
    expect(collapsed).toContain("platform-grid platform-grid--collapsed");
    expect(collapsed).toContain("sidebar-collapsed");
    expect(collapsed.match(/role="status"/g)).toHaveLength(1);
    expect(collapsed).not.toContain("conteudo protegido");
    expect(collapsed).not.toMatch(/<a |<button/);

    // Sem escolha salva: o CSS decide a largura pela tela, já no 1º quadro.
    expect(serverHtml("/teach/sales", null)).toContain("platform-grid--auto");
    expect(serverHtml("/teach/sales", "expanded")).toContain("sidebar-expanded");
  });

  it("fora da casca, o anel de sempre", () => {
    const html = serverHtml("/learn/courses/intro", null);
    expect(html).not.toContain("platform-grid");
    expect(html).toContain("authFlow.loading.title</h1>");
  });
});
