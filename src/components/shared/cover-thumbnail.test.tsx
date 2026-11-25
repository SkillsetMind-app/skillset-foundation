import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Covers are stored as uploaded (hundreds of kB each). The contract: a cover in
// our storage goes through the image optimizer, sized for its box; any other
// address is drawn exactly as before, because the optimizer refuses hosts it
// does not know and a refused image is a broken one.

const STORAGE = "https://project.supabase.co";

async function renderThumbnail(props: { src: string; eager?: boolean; highPriority?: boolean }) {
  const { CoverThumbnail } = await import("@/components/shared/cover-thumbnail");
  const { container } = render(
    <div className="relative">
      <CoverThumbnail alt="" sizes="96px" {...props} />
    </div>,
  );
  return container.querySelector("img") as HTMLImageElement;
}

describe("CoverThumbnail", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", STORAGE);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("serves a cover from our storage through the optimizer, sized for the box", async () => {
    const original = `${STORAGE}/storage/v1/object/public/public-media/covers/a.jpg`;
    const img = await renderThumbnail({ src: original });

    expect(img.getAttribute("src")).toContain("/_next/image?url=");
    expect(img.getAttribute("src")).toContain(encodeURIComponent(original));
    expect(img.getAttribute("src")).not.toBe(original);
    expect(img).toHaveAttribute("sizes", "96px");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("alt", "");
  });

  it("loads right away when it is above the fold", async () => {
    const img = await renderThumbnail({ src: `${STORAGE}/storage/v1/object/public/x/a.jpg`, eager: true });
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).not.toHaveAttribute("fetchpriority");
  });

  it("puts the main picture of a screen first in line", async () => {
    const img = await renderThumbnail({ src: `${STORAGE}/storage/v1/object/public/x/a.jpg`, highPriority: true });
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("fetchpriority", "high");
  });

  it("draws any other address untouched", async () => {
    for (const src of [
      "https://cdn.example/cover.jpg",
      // Looks like ours, is not: same path on another host.
      "https://evil.example/storage/v1/object/public/x/a.jpg",
      `${STORAGE}.evil.example/storage/v1/object/public/x/a.jpg`,
      "/brand/logo-mark.png",
    ]) {
      const img = await renderThumbnail({ src });
      expect(img).toHaveAttribute("src", src);
      expect(img.className).toBe("h-full w-full object-cover");
      cleanup();
    }
  });

  it("draws everything untouched when the storage address is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.resetModules();
    const src = "/storage/v1/object/public/x/a.jpg";
    const img = await renderThumbnail({ src });
    expect(img).toHaveAttribute("src", src);
  });
});
