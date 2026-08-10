import { describe, expect, it } from "vitest";

import { getTrustedLessonEmbed } from "./lesson-embed";

describe("trusted lesson embeds", () => {
  it("converts YouTube watch, short, and embed links to no-cookie embed URLs", () => {
    expect(getTrustedLessonEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
      .toMatchObject({
        provider: "youtube",
        embedUrl:
          "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1",
      });
    expect(getTrustedLessonEmbed("https://youtu.be/dQw4w9WgXcQ")?.embedUrl).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1",
    );
    expect(getTrustedLessonEmbed("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.embedUrl)
      .toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1");
  });

  it("keeps the embed on the no-cookie origin the message listener trusts", () => {
    // The auto-advance listener only accepts messages whose event.origin
    // matches this URL's origin, so a change here is a security change.
    const embed = getTrustedLessonEmbed("https://youtu.be/dQw4w9WgXcQ");

    expect(new URL(embed!.embedUrl).origin).toBe(
      "https://www.youtube-nocookie.com",
    );
    expect(new URL(embed!.embedUrl).searchParams.get("enablejsapi")).toBe("1");
  });

  it("converts Vimeo links to player embeds", () => {
    expect(getTrustedLessonEmbed("https://vimeo.com/123456789")).toMatchObject({
      provider: "vimeo",
      embedUrl: "https://player.vimeo.com/video/123456789",
    });
  });

  it("rejects untrusted or malformed embeds", () => {
    expect(getTrustedLessonEmbed("javascript:alert(1)")).toBeNull();
    expect(getTrustedLessonEmbed("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(getTrustedLessonEmbed("")).toBeNull();
  });
});
