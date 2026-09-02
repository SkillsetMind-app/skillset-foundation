import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteFooter } from "@/components/site/site-footer";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// SiteFooter é server component assíncrono: resolve o idioma pelo cookie.
// Sem cookie = inglês.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

afterEach(cleanup);

describe("SiteFooter", () => {
  it("lista Cursos, Instrutores e Sobre, e /promise aparece uma vez só", async () => {
    render(await SiteFooter());

    // Três páginas públicas que nem o menu de cima lista: o rodapé é a porta.
    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute(
      "href",
      "/courses",
    );
    expect(screen.getByRole("link", { name: "Instructors" })).toHaveAttribute(
      "href",
      "/instructors",
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      "/about",
    );

    // Antes: "The Promise" e "Creator Promise" apontavam para a MESMA página.
    const promiseLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/promise");
    expect(promiseLinks).toHaveLength(1);
    expect(screen.queryByText("Creator Promise")).not.toBeInTheDocument();
  });

  it("tem os rótulos novos nos dois dicionários", () => {
    const es = getDictionary("es");
    // translate() cai para o inglês quando falta a chave; se o rótulo em
    // espanhol saísse igual ao inglês, a chave não estaria em es.json.
    expect(translate(es, "footer.courses")).toBe("Cursos");
    expect(translate(es, "footer.instructors")).toBe("Instructores");
    expect(translate(es, "footer.about")).not.toBe("About");
  });
});
