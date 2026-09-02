import { describe, expect, it } from "vitest";

import { withAutoplay } from "@/components/courses/bunny-video-player";
import { withEmbedAutoplay } from "@/components/learn/trusted-embed-player";

// Depois do cartao "Proxima aula", o proximo video tem que COMECAR a tocar —
// antes ele carregava e ficava parado, esperando outro clique.

describe("autoplay nos embeds", () => {
  it("Bunny: so acrescenta autoplay=true quando a sala pede", () => {
    const url = "https://iframe.mediadelivery.net/embed/123/abc?token=x";

    expect(withAutoplay(url, false)).toBe(url);
    expect(withAutoplay(url)).toBe(url);

    const on = new URL(withAutoplay(url, true));
    expect(on.searchParams.get("autoplay")).toBe("true");
    expect(on.searchParams.get("token")).toBe("x");
    expect(on.origin).toBe("https://iframe.mediadelivery.net");
  });

  it("YouTube/Vimeo: so acrescenta autoplay=1 quando a sala pede, sem mexer na origem", () => {
    const url = "https://www.youtube-nocookie.com/embed/abc?enablejsapi=1";

    expect(withEmbedAutoplay(url, false)).toBe(url);

    const on = new URL(withEmbedAutoplay(url, true));
    expect(on.searchParams.get("autoplay")).toBe("1");
    expect(on.searchParams.get("enablejsapi")).toBe("1");
    expect(on.origin).toBe("https://www.youtube-nocookie.com");
  });

  it("URL invalida passa intacta (nunca quebra o player por causa do autoplay)", () => {
    expect(withAutoplay("not a url", true)).toBe("not a url");
    expect(withEmbedAutoplay("not a url", true)).toBe("not a url");
  });
});
