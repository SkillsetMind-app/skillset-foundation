import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime";
import { imageConfigDefault } from "next/dist/shared/lib/image-config";
import config from "../../../next.config";

import {
  BRAND_PORTRAITS,
  BrandPortrait,
  PORTRAIT_FADE_MS,
  PORTRAIT_INTERVAL_MS,
} from "@/components/shared/brand-portrait";

// jsdom never loads images, so `img.complete` would stay false and the
// rotation (which only flips once the next face has loaded) would never
// advance. Pretend every image has loaded unless a test says otherwise.
const nativeComplete = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "complete",
)!;
let imagesLoaded = true;

beforeEach(() => {
  imagesLoaded = true;
  Object.defineProperty(HTMLImageElement.prototype, "complete", {
    configurable: true,
    get: () => imagesLoaded,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(HTMLImageElement.prototype, "complete", nativeComplete);
});

function sources(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("img")).map((img) =>
    decodeURIComponent(img.getAttribute("src") ?? ""),
  );
}

function faceOf(src: string): string {
  const face = BRAND_PORTRAITS.find((portrait) => src.includes(portrait));
  if (!face) throw new Error(`not a brand portrait: ${src}`);
  return face;
}

/** The face on screen: the one layer without aria-hidden. */
function visible(container: HTMLElement): string {
  const shown = container.querySelectorAll("img:not([aria-hidden])");
  expect(shown).toHaveLength(1);
  return faceOf(decodeURIComponent(shown[0].getAttribute("src") ?? ""));
}

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function rotating() {
  return render(
    <BrandPortrait
      rotate
      imageClassName="object-cover"
      sizes="100vw"
      priority
    />,
  );
}

describe("BrandPortrait", () => {
  it("without rotate (sign-in) shows one brand portrait and never swaps it", () => {
    vi.useFakeTimers();
    const { container } = render(
      <BrandPortrait imageClassName="object-cover" sizes="100vw" priority />,
    );

    const [src, ...rest] = sources(container);
    expect(rest).toEqual([]);
    expect(BRAND_PORTRAITS.some((portrait) => src.includes(portrait))).toBe(
      true,
    );

    // The sign-in panel keeps holding still: a minute later it is the same
    // single image, no second layer, no timers.
    tick(60_000);
    expect(sources(container)).toEqual([src]);
    expect(container.querySelector("[aria-hidden]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one draw across every portrait on the page", () => {
    const { container } = render(
      <>
        <BrandPortrait imageClassName="hero" sizes="100vw" />
        <BrandPortrait imageClassName="panel" sizes="60vw" />
      </>,
    );

    const [hero, panel] = sources(container);
    expect(panel).toBe(hero);
  });

  it("optimizes the original PNG once at portrait quality", () => {
    const { container } = render(
      <ImageConfigContext.Provider value={{ ...imageConfigDefault, ...config.images }}>
        <BrandPortrait imageClassName="hero" sizes="100vw" />
      </ImageConfigContext.Provider>,
    );
    const image = container.querySelector("img")!;
    const url = new URL(image.src, "https://example.test");
    expect(url.searchParams.get("url")).toMatch(/\.png$/);
    expect(url.searchParams.get("q")).toBe("90");
  });
});

describe("BrandPortrait rotate (homepage hero)", () => {
  it("starts on the visit's face, preloads the next one hidden, then crossfades to it after the interval", () => {
    vi.useFakeTimers();
    const { container } = rotating();

    // First paint: one image only, the LCP candidate. In the app router
    // `priority` becomes a ReactDOM.preload of that face (a <link> in <head>),
    // not a fetchpriority attribute on the <img>.
    expect(sources(container)).toHaveLength(1);
    const first = visible(container);
    const preloadLinks = Array.from(
      document.head.querySelectorAll('link[rel="preload"][as="image"]'),
    ).map((link) => decodeURIComponent(link.getAttribute("imagesrcset") ?? ""));
    expect(preloadLinks.some((srcSet) => srcSet.includes(first))).toBe(true);

    // Once the (non-existent) opening fade is over, the next face is mounted
    // underneath, hidden from assistive tech, eager so it loads off-screen.
    tick(PORTRAIT_FADE_MS);
    const layers = container.querySelectorAll("img");
    expect(layers).toHaveLength(2);
    const preloaded = layers[1];
    expect(preloaded).toHaveAttribute("aria-hidden", "true");
    expect(preloaded).toHaveAttribute("loading", "eager");
    expect(preloaded).toHaveAttribute("alt", "");
    expect(preloaded.style.opacity).toBe("0");
    const next = faceOf(decodeURIComponent(preloaded.getAttribute("src") ?? ""));
    expect(next).not.toBe(first);
    expect(visible(container)).toBe(first);

    // Nothing moves before the interval is up…
    tick(PORTRAIT_INTERVAL_MS - PORTRAIT_FADE_MS - 1);
    expect(visible(container)).toBe(first);

    // …and at the interval the preloaded face is the one on screen, the
    // old one is the hidden layer. Same two <img>, only roles swapped.
    tick(1);
    expect(visible(container)).toBe(next);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(layers[0]).toHaveAttribute("aria-hidden", "true");
    expect(layers[1]).not.toHaveAttribute("aria-hidden");
    expect(layers[1].style.transition).toContain(`${PORTRAIT_FADE_MS}ms`);
  });

  it("walks the other nine faces shuffled before coming back, never the same face twice in a row", () => {
    vi.useFakeTimers();
    const { container } = rotating();
    const first = visible(container);

    const seen: string[] = [first];
    for (let i = 0; i < 25; i++) {
      // Two steps per interval: act() batches every state update inside one
      // advance, so the face dealt by the preload timer must reach the DOM
      // (as it does in a browser) before the interval tick checks it.
      tick(PORTRAIT_FADE_MS);
      tick(PORTRAIT_INTERVAL_MS - PORTRAIT_FADE_MS);
      const face = visible(container);
      expect(face).not.toBe(seen[seen.length - 1]);
      seen.push(face);
    }

    // First cycle: each of the other nine exactly once, in some order.
    const firstCycle = seen.slice(1, 10);
    expect(new Set(firstCycle).size).toBe(9);
    expect(firstCycle).not.toContain(first);
    // Then it keeps going (infinite loop), still without a back-to-back repeat.
    expect(seen).toHaveLength(26);
  });

  it("does not flip while the next face is still loading, and catches up once it has", () => {
    vi.useFakeTimers();
    imagesLoaded = false;
    const { container } = rotating();
    const first = visible(container);

    tick(PORTRAIT_INTERVAL_MS * 2);
    expect(visible(container)).toBe(first);

    imagesLoaded = true;
    tick(PORTRAIT_INTERVAL_MS);
    expect(visible(container)).not.toBe(first);
  });

  it("holds still under prefers-reduced-motion: reduce", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        addEventListener() {},
        removeEventListener() {},
      })),
    );
    const { container } = rotating();
    const first = visible(container);

    tick(PORTRAIT_INTERVAL_MS * 10);
    expect(visible(container)).toBe(first);
    expect(sources(container)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses while the tab is hidden and resumes when it is shown again", () => {
    vi.useFakeTimers();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    const { container } = rotating();
    const first = visible(container);

    tick(PORTRAIT_INTERVAL_MS * 3);
    expect(visible(container)).toBe(first);

    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    tick(PORTRAIT_INTERVAL_MS);
    expect(visible(container)).not.toBe(first);
  });

  it("clears its timers on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = rotating();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders nothing on the server (nothing for hydration to disagree about) and starts the client on the shared draw", () => {
    // The server has no per-visitor randomness: with or without rotate the
    // slot is empty in the HTML, so the client's first face can never mismatch
    // what was streamed.
    expect(
      renderToString(<BrandPortrait rotate imageClassName="hero" sizes="100vw" priority />),
    ).not.toContain("<img");

    vi.useFakeTimers();
    const { container } = render(
      <>
        <div data-testid="hero">
          <BrandPortrait rotate imageClassName="hero" sizes="100vw" priority />
        </div>
        <div data-testid="panel">
          <BrandPortrait imageClassName="panel" sizes="60vw" />
        </div>
      </>,
    );
    const hero = container.querySelector('[data-testid="hero"]') as HTMLElement;
    const panel = container.querySelector('[data-testid="panel"]') as HTMLElement;
    expect(visible(hero)).toBe(faceOf(sources(panel)[0]));
  });
});
