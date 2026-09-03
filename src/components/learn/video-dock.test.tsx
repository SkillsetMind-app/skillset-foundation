import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoDock } from "@/components/learn/video-dock";

/**
 * No celular o vídeo sumia ao rolar. Agora ele se prende no topo, pequeno —
 * e o que mais importa provar é o que NÃO acontece: o elemento do vídeo não é
 * arrancado e recolocado, porque um iframe remontado recarrega e a aula
 * voltaria ao segundo zero.
 */

let observerCallback: IntersectionObserverCallback | null = null;
const disconnect = vi.fn();

class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback;
  }

  observe() {}
  unobserve() {}
  disconnect() {
    disconnect();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Rola a página: `top` negativo = o vídeo ficou acima da tela. */
function scrollTo(top: number, height = 200) {
  const intersecting = top + height > 0 && top < 800;

  act(() => {
    observerCallback?.(
      [
        {
          isIntersecting: intersecting,
          boundingClientRect: { top, height } as DOMRectReadOnly,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  });
}

beforeEach(() => {
  observerCallback = null;
  disconnect.mockClear();
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("mini player no celular", () => {
  it("passado o vídeo ele vira mini, e o MESMO nó de vídeo continua na página", () => {
    render(
      <VideoDock title="Aula 3 — Fechamento">
        <video data-testid="clip" />
      </VideoDock>,
    );

    const dock = document.querySelector(".member-video-dock") as HTMLElement;
    const before = screen.getByTestId("clip");

    expect(dock.dataset.mini).toBe("false");

    scrollTo(-400);

    expect(dock.dataset.mini).toBe("true");
    expect(dock.className).toContain("member-video-dock--mini");
    // A prova do não-remonte: MESMO objeto de nó, antes e depois.
    expect(screen.getByTestId("clip")).toBe(before);
    // E o espaço do quadro fica reservado, senão a página salta.
    expect(dock.style.minHeight).toBe("200px");
    expect(screen.getByText("Aula 3 — Fechamento")).toBeInTheDocument();
  });

  it("rolando de volta ele desliga sozinho", () => {
    render(
      <VideoDock title="Aula 3">
        <video data-testid="clip" />
      </VideoDock>,
    );

    const dock = document.querySelector(".member-video-dock") as HTMLElement;

    scrollTo(-400);
    expect(dock.dataset.mini).toBe("true");

    scrollTo(120);
    expect(dock.dataset.mini).toBe("false");
    expect(dock.style.minHeight).toBe("");
  });

  it("fechar vale até o vídeo voltar à tela — não desliga o recurso", () => {
    render(
      <VideoDock title="Aula 3" closeLabel="Fechar mini player">
        <video data-testid="clip" />
      </VideoDock>,
    );

    const dock = document.querySelector(".member-video-dock") as HTMLElement;

    scrollTo(-400);
    fireEvent.click(screen.getByRole("button", { name: "Fechar mini player" }));
    expect(dock.dataset.mini).toBe("false");

    // Continuar rolando para baixo NÃO o traz de volta.
    scrollTo(-900);
    expect(dock.dataset.mini).toBe("false");

    // Voltar ao vídeo e passar de novo, sim.
    scrollTo(120);
    scrollTo(-400);
    expect(dock.dataset.mini).toBe("true");
  });

  it("chegar ao rodapé não acende o mini (o vídeo está ACIMA, não abaixo)", () => {
    render(
      <VideoDock title="Aula 3">
        <video data-testid="clip" />
      </VideoDock>,
    );

    const dock = document.querySelector(".member-video-dock") as HTMLElement;

    // Primeira leitura com a sala ainda abaixo da dobra: top positivo e fora
    // da tela. Antes de existir a checagem de `top`, isto acendia o mini.
    scrollTo(2000);
    expect(dock.dataset.mini).toBe("false");
  });

  it("aula sem vídeo não observa nada: o quadro vazio nunca sobe", () => {
    render(
      <VideoDock title="Aula de texto" enabled={false}>
        <p>Sem vídeo</p>
      </VideoDock>,
    );

    expect(observerCallback).toBeNull();
    expect(
      (document.querySelector(".member-video-dock") as HTMLElement).dataset.mini,
    ).toBe("false");
  });
});
