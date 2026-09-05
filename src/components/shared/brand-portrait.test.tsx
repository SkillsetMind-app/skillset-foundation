import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime";
import { imageConfigDefault } from "next/dist/shared/lib/image-config";
import config from "../../../next.config";

import {
  BRAND_PORTRAITS,
  BrandPortrait,
} from "@/components/shared/brand-portrait";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function sources(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("img")).map((img) =>
    decodeURIComponent(img.getAttribute("src") ?? ""),
  );
}

describe("BrandPortrait", () => {
  it("shows one brand portrait and never swaps it", () => {
    vi.useFakeTimers();
    const { container } = render(
      <BrandPortrait imageClassName="object-cover" sizes="100vw" priority />,
    );

    const [src, ...rest] = sources(container);
    expect(rest).toEqual([]);
    expect(BRAND_PORTRAITS.some((portrait) => src.includes(portrait))).toBe(
      true,
    );

    // The old component crossfaded to the next face every 3 s. A minute
    // later this one is still the same single image.
    vi.advanceTimersByTime(60_000);
    expect(sources(container)).toEqual([src]);
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
