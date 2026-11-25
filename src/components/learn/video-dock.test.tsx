import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoDock } from "@/components/learn/video-dock";

/**
 * On a phone the video used to disappear when scrolling. Now it pins to the
 * top, small, and what matters most to prove is what does NOT happen: the
 * video element is not pulled out and put back, because a remounted iframe
 * reloads and the lesson would return to second zero.
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

/** Scrolls the page: negative `top` = the video is above the screen. */
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

describe("mini player on a phone", () => {
  it("once the video is scrolled past it becomes a mini, and the SAME video node stays on the page", () => {
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
    // The proof of no remount: the SAME node object, before and after.
    expect(screen.getByTestId("clip")).toBe(before);
    // And the frame's space stays reserved, otherwise the page jumps.
    expect(dock.style.minHeight).toBe("200px");
    expect(screen.getByText("Aula 3 — Fechamento")).toBeInTheDocument();
  });

  it("scrolling back turns it off by itself", () => {
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

  it("closing lasts until the video returns to the screen and does not turn the feature off", () => {
    render(
      <VideoDock title="Aula 3" closeLabel="Fechar mini player">
        <video data-testid="clip" />
      </VideoDock>,
    );

    const dock = document.querySelector(".member-video-dock") as HTMLElement;

    scrollTo(-400);
    fireEvent.click(screen.getByRole("button", { name: "Fechar mini player" }));
    expect(dock.dataset.mini).toBe("false");

    // Continuing to scroll down does NOT bring it back.
    scrollTo(-900);
    expect(dock.dataset.mini).toBe("false");

    // Going back to the video and passing it again does.
    scrollTo(120);
    scrollTo(-400);
    expect(dock.dataset.mini).toBe("true");
  });

  it("reaching the footer does not turn the mini on (the video is ABOVE, not below)", () => {
    render(
      <VideoDock title="Aula 3">
        <video data-testid="clip" />
      </VideoDock>,
    );

    const dock = document.querySelector(".member-video-dock") as HTMLElement;

    // First reading with the room still below the fold: positive top and off
    // screen. Before the `top` check existed, this turned the mini on.
    scrollTo(2000);
    expect(dock.dataset.mini).toBe("false");
  });

  it("a lesson without video observes nothing: the empty frame never goes up", () => {
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
