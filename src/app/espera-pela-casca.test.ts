import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  OTHER_SHELL_PREFIXES,
  PLATFORM_SHELL_AREAS,
  opensInPlatformShell,
} from "@/components/platform/platform-routes";

// F-03, estágio 0: enquanto a sessão resolve, a guarda de login espera com a
// forma da PlatformShell nas rotas que opensInPlatformShell aceita. Leitura do
// fonte, como em avisos-esperas-restantes.test.tsx: cada página protegida das
// cinco áreas tem de abrir na PlatformShell, ou estar na lista de fora
// (OTHER_SHELL_PREFIXES). Uma página nova com outra casca quebra aqui, em vez
// de esperar com uma forma que não é a dela.

const app = join(process.cwd(), "src", "app");
const components = join(process.cwd(), "src", "components");

// Sem comentários: várias páginas citam "PlatformShell" num comentário.
function code(path: string) {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// As páginas que passam a guarda ou a casca para um componente. O componente
// é lido junto com a página. Página nova que delega para outro: entra aqui.
const delegates: Record<string, string> = {
  // O painel interno monta a PlatformShell dele.
  "<OpsDashboard": "admin/ops-dashboard.tsx",
  // As páginas da sala de aula passam a guarda e a MemberAreaShell para ele.
  "<LearnCoursePage": "learn/learn-course-page.tsx",
  // Só deixa passar o professor: devolve os filhos (a PlatformShell da página) ou nada.
  "<PlansForTeachersOnly": "account/plans-for-teachers-only.tsx",
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

// src/app/teach/sales/[orderId]/page.tsx -> /teach/sales/x (grupo "(x)" sai).
function routeOf(file: string) {
  const segments = relative(app, dirname(file))
    .split(sep)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) => (segment.startsWith("[") ? "x" : segment));
  return `/${segments.join("/")}`;
}

const pages = PLATFORM_SHELL_AREAS.flatMap((area) => sources(join(app, area.slice(1))))
  .map((file) => {
    const own = code(file);
    const delegated = Object.entries(delegates)
      .filter(([tag]) => own.includes(tag))
      .map(([, component]) => code(join(components, component)));
    const source = [own, ...delegated].join("\n");
    return {
      file: relative(app, file).split(sep).join("/"),
      route: routeOf(file),
      guarded: source.includes("<ProtectedSurface"),
      shell: source.includes("<PlatformShell"),
    };
  })
  .filter((page) => page.guarded);

describe("a espera da guarda tem a casca de cada página", () => {
  // Lista vazia vira zero testes e passa calada.
  it("acha as páginas protegidas das cinco áreas, com e sem casca", () => {
    expect(pages.length).toBeGreaterThan(30);
    expect(pages.some((page) => page.shell)).toBe(true);
    expect(pages.some((page) => !page.shell)).toBe(true);
  });

  it.each(pages.map((page) => [page.file, page] as const))("%s", (_file, page) => {
    // Se quebrou: a página tem outra casca (ou delega a PlatformShell para um
    // componente que ainda não está em `delegates`). Ponha o caminho dela em
    // OTHER_SHELL_PREFIXES, ou o componente em `delegates`.
    expect(page.shell, `${page.route} abre na PlatformShell?`).toBe(opensInPlatformShell(page.route));
  });

  // Uma exceção sem página por trás é lixo na regra: some daqui também.
  it.each(OTHER_SHELL_PREFIXES)("%s ainda tem página protegida fora da casca", (prefix) => {
    expect(pages.some((page) => page.route.startsWith(prefix) && !page.shell)).toBe(true);
  });

  it("os componentes delegados fazem o que a lista diz", () => {
    expect(code(join(components, "admin/ops-dashboard.tsx"))).toContain("<PlatformShell");
    const classroom = code(join(components, "learn/learn-course-page.tsx"));
    expect(classroom).toContain("<ProtectedSurface");
    expect(classroom).toContain("<MemberAreaShell");
    expect(classroom).not.toContain("<PlatformShell");
    expect(code(join(components, "account/plans-for-teachers-only.tsx"))).toContain("canTeach ? children : null");
  });
});
