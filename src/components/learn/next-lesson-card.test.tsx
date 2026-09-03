import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextLessonCard } from "@/components/learn/next-lesson-card";
import type { Lesson } from "@/domain/learning";

// O avanco automatico existia, mas em silencio: a aula mudava sem aviso, sem
// "cancelar", e o proximo video nao comecava a tocar. Agora um cartao sobre o
// video conta 5 s com "Assistir agora" e "Cancelar"; sem acao, a proxima toca.

const lesson = {
  id: "l2",
  title: "Lesson two",
  type: "video",
  duration: "7 min",
  isPreview: false,
} as unknown as Lesson;

describe("NextLessonCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mostra a proxima aula e a contagem de 5 s", () => {
    render(<NextLessonCard lesson={lesson} onPlay={() => {}} onCancel={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Next lesson" })).toBeInTheDocument();
    expect(screen.getByText("Lesson two")).toBeInTheDocument();
    expect(screen.getByText(/Next lesson in 5s/)).toBeInTheDocument();
  });

  it("'Cancelar' faz o cartao DESCER e so entao avisa o pai; onPlay nunca", () => {
    // Antes o cartao aparecia e sumia seco, sem nada entre um quadro e outro.
    const onPlay = vi.fn();
    const onCancel = vi.fn();
    render(<NextLessonCard lesson={lesson} onPlay={onPlay} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Ainda na tela, saindo: o pai so desmonta quando a animacao termina.
    expect(screen.getByRole("dialog", { name: "Next lesson" })).toHaveClass("is-leaving");
    expect(onCancel).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    // E a contagem parou junto: nem depois dos 5 s o cartao troca de aula.
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("entra subindo com fade — animacao, nao aparicao seca", () => {
    render(<NextLessonCard lesson={lesson} onPlay={() => {}} onCancel={() => {}} />);

    // A animacao de entrada mora no CSS, na classe do cartao.
    expect(screen.getByRole("dialog", { name: "Next lesson" })).toHaveClass(
      "member-next-lesson",
    );
    expect(screen.getByRole("dialog", { name: "Next lesson" })).not.toHaveClass("is-leaving");
  });

  it("'Assistir agora' toca na hora", () => {
    const onPlay = vi.fn();
    render(<NextLessonCard lesson={lesson} onPlay={onPlay} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Watch now/ }));

    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("sem acao, toca sozinho depois de 5 s — e nao antes", () => {
    const onPlay = vi.fn();
    render(<NextLessonCard lesson={lesson} onPlay={onPlay} onCancel={() => {}} />);

    // Um tick por act: cada segundo re-arma o timer no efeito, e o efeito so
    // roda depois que o act anterior descarrega a atualizacao de estado.
    for (let tick = 0; tick < 4; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByText(/Next lesson in 1s/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});

describe("a sala de aula usa o cartao em vez de trocar em silencio", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/learn/enrolled-course-workspace.tsx"),
    "utf8",
  );

  it("ao terminar o video, propoe a proxima (setNextUp) em vez de selecionar direto", () => {
    const handler = source.slice(
      source.indexOf("async function handleLessonEnded"),
      source.indexOf("function playNextUp"),
    );

    expect(handler).toContain("setNextUp(nextInOrder)");
    expect(handler).not.toContain("selectLesson(nextInOrder.id)");
  });

  it("quem aceita ganha autoplay so naquela aula", () => {
    expect(source).toContain("autoplay={autoplayLessonId === selectedLesson.id}");
    expect(source).toContain("<NextLessonCard");
  });
});
