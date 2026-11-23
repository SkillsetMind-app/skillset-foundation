import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ClassroomLoading } from "@/components/learn/classroom-loading";

// "Continue" do painel (?lesson=) passava por três formas numa espera só: o
// arquivo de rota e o fallback do Suspense com o bloco alto da capa (~400px),
// depois o workspace com 52px, depois o cabeçalho de verdade. Agora quem lê o
// endereço passa `short` pela aula; quem não lê fica no curto (o caminho mais
// comum), e a espera tem UMA forma até o cabeçalho chegar.
const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function topBlock(container: HTMLElement) {
  return container.querySelector("section > div") as HTMLElement;
}

describe("a espera da sala tem uma forma só", () => {
  it("curta: o bloco do topo tem a altura do cabeçalho curto", () => {
    const { container } = render(<ClassroomLoading label="Loading course..." short />);
    expect(topBlock(container)).toHaveClass("h-[52px]");
    expect(screen.getByRole("status")).toHaveTextContent("Loading course...");
  });

  it("sem `short`: o bloco do topo tem a altura da capa", () => {
    const { container } = render(<ClassroomLoading label="Loading course..." />);
    expect(topBlock(container).className).toContain("min-h-[clamp(300px,min(43vw,48svh),520px)]");
  });

  it("quem não lê o endereço usa a forma curta; os workspaces decidem pela aula no endereço", () => {
    expect(source("src/app/learn/courses/[slug]/loading.tsx")).toMatch(/<ClassroomLoading label=\{[^}]+\} short \/>/);
    expect(source("src/components/learn/learn-course-page.tsx")).toMatch(/<ClassroomLoading label=\{[^}]+\} short \/>/);
    expect(source("src/components/learn/creator-course-workspace.tsx")).toContain(
      'short={Boolean(searchParams.get("lesson")) && tab !== "about"}',
    );
    expect(source("src/components/learn/enrolled-course-workspace.tsx")).toContain(
      'short={Boolean(lessonParam) && !previewMode && tab !== "about"}',
    );
  });
});
