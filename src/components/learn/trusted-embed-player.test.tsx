import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TrustedEmbedPlayer } from "@/components/learn/trusted-embed-player";

const EMBED = "https://www.youtube.com/embed/abc123?enablejsapi=1";
const ORIGIN = "https://www.youtube.com";

afterEach(cleanup);

function mount(onEnded: () => void, embedUrl = EMBED) {
  const { container } = render(
    <TrustedEmbedPlayer
      embedUrl={embedUrl}
      onEnded={onEnded}
      provider="youtube"
      title="Lesson 1"
    />,
  );

  return container.querySelector("iframe") as HTMLIFrameElement;
}

/** Deliver a window message as if it came from `source` at `origin`. */
function deliver(
  data: unknown,
  { origin = ORIGIN, source }: { origin?: string; source: Window | null },
) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

describe("TrustedEmbedPlayer", () => {
  it("marks the lesson watched on the YouTube ENDED state", () => {
    const onEnded = vi.fn();
    const iframe = mount(onEnded);

    deliver(JSON.stringify({ event: "onStateChange", info: 0 }), {
      source: iframe.contentWindow,
    });

    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("accepts the object form of the state payload", () => {
    const onEnded = vi.fn();
    const iframe = mount(onEnded);

    deliver(JSON.stringify({ event: "onStateChange", info: { playerState: 0 } }), {
      source: iframe.contentWindow,
    });

    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("accepts Vimeo's ended shapes", () => {
    const onEnded = vi.fn();
    const iframe = mount(onEnded);

    deliver(JSON.stringify({ event: "finish" }), { source: iframe.contentWindow });
    deliver(JSON.stringify({ event: "ended" }), { source: iframe.contentWindow });

    expect(onEnded).toHaveBeenCalledTimes(2);
  });

  it("ignores a message from another origin", () => {
    const onEnded = vi.fn();
    const iframe = mount(onEnded);

    // The whole point of the origin check: any page able to postMessage could
    // otherwise fake "watched" and unlock the next lesson.
    deliver(JSON.stringify({ event: "onStateChange", info: 0 }), {
      origin: "https://evil.example",
      source: iframe.contentWindow,
    });

    expect(onEnded).not.toHaveBeenCalled();
  });

  it("ignores a message from a different window on the right origin", () => {
    const onEnded = vi.fn();
    mount(onEnded);

    // A second embed or an ad frame on the same page must not advance
    // this lesson.
    deliver(JSON.stringify({ event: "onStateChange", info: 0 }), {
      source: window,
    });

    expect(onEnded).not.toHaveBeenCalled();
  });

  it("ignores non-ended player states", () => {
    const onEnded = vi.fn();
    const iframe = mount(onEnded);

    // 1 = PLAYING, 2 = PAUSED.
    deliver(JSON.stringify({ event: "onStateChange", info: 1 }), {
      source: iframe.contentWindow,
    });
    deliver(JSON.stringify({ event: "onStateChange", info: 2 }), {
      source: iframe.contentWindow,
    });

    expect(onEnded).not.toHaveBeenCalled();
  });

  it("survives a payload that is not JSON", () => {
    const onEnded = vi.fn();
    const iframe = mount(onEnded);

    expect(() =>
      deliver("not json at all", { source: iframe.contentWindow }),
    ).not.toThrow();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("never listens at all when the embed url is malformed", () => {
    const onEnded = vi.fn();
    const iframe = mount(onEnded, "not-a-url");

    deliver(JSON.stringify({ event: "onStateChange", info: 0 }), {
      source: iframe.contentWindow,
    });

    expect(onEnded).not.toHaveBeenCalled();
  });
});
