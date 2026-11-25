import { describe, expect, it } from "vitest";

import { withAutoplay } from "@/components/courses/bunny-video-player";
import { withEmbedAutoplay } from "@/components/learn/trusted-embed-player";

// After the "Next lesson" card, the next video has to START playing —
// before, it loaded and sat still, waiting for another click.

describe("autoplay on embeds", () => {
  it("Bunny: only adds autoplay=true when the classroom asks for it", () => {
    const url = "https://iframe.mediadelivery.net/embed/123/abc?token=x";

    expect(withAutoplay(url, false)).toBe(url);
    expect(withAutoplay(url)).toBe(url);

    const on = new URL(withAutoplay(url, true));
    expect(on.searchParams.get("autoplay")).toBe("true");
    expect(on.searchParams.get("token")).toBe("x");
    expect(on.origin).toBe("https://iframe.mediadelivery.net");
  });

  it("YouTube/Vimeo: only adds autoplay=1 when the classroom asks for it, without touching the origin", () => {
    const url = "https://www.youtube-nocookie.com/embed/abc?enablejsapi=1";

    expect(withEmbedAutoplay(url, false)).toBe(url);

    const on = new URL(withEmbedAutoplay(url, true));
    expect(on.searchParams.get("autoplay")).toBe("1");
    expect(on.searchParams.get("enablejsapi")).toBe("1");
    expect(on.origin).toBe("https://www.youtube-nocookie.com");
  });

  it("an invalid URL passes through intact (never breaks the player because of autoplay)", () => {
    expect(withAutoplay("not a url", true)).toBe("not a url");
    expect(withEmbedAutoplay("not a url", true)).toBe("not a url");
  });
});
