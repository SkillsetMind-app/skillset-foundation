"use client";

import { useEffect, useRef } from "react";

// Auto-advance for embedded players. This branch renders YouTube AND Vimeo —
// inferLessonVideoSource labels every trusted embed "youtube" — so nothing here
// may assume one vendor: we subscribe with both handshakes and accept either
// vendor's "ended" shape.
//
// No external IFrame API script is loaded (script-src does not allow
// youtube.com); enablejsapi=1 on the embed URL is enough for the raw
// postMessage handshake. Every inbound message is checked against this iframe's
// own window and exact origin before anything happens.
//
// Its own file rather than inline in enrolled-course-workspace: this is the
// trust boundary that decides whether a lesson counts as watched, and the
// workspace's import graph (auth context, Bunny player, community feed) makes
// it impossible to render in a test without standing the whole classroom up.
export function TrustedEmbedPlayer({
  embedUrl,
  onEnded,
  provider,
  title,
}: {
  embedUrl: string;
  onEnded: () => void;
  provider: "youtube" | "vimeo";
  title: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let embedOrigin: string;

    try {
      embedOrigin = new URL(embedUrl).origin;
    } catch {
      return;
    }

    function handleMessage(event: MessageEvent) {
      if (
        event.origin !== embedOrigin
        || event.source !== iframeRef.current?.contentWindow
      ) {
        return;
      }

      let payload: unknown = event.data;

      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }

      const message = payload as { event?: unknown; info?: unknown } | null;

      if (!message || typeof message !== "object") {
        return;
      }

      if (message.event === "onStateChange") {
        // YouTube player state 0 = ENDED. `info` is the state itself on the
        // raw protocol, but an object on some builds.
        const info =
          typeof message.info === "object" && message.info !== null
            ? (message.info as { playerState?: unknown }).playerState
            : message.info;

        if (info === 0) {
          onEnded();
        }

        return;
      }

      if (message.event === "ended" || message.event === "finish") {
        onEnded();
      }
    }

    window.addEventListener("message", handleMessage);

    return () => window.removeEventListener("message", handleMessage);
  }, [embedUrl, onEnded]);

  function subscribeToEnded() {
    const target = iframeRef.current?.contentWindow;

    if (!target) {
      return;
    }

    try {
      target.postMessage(
        JSON.stringify(
          provider === "youtube"
            ? { event: "listening", id: 1, channel: "widget" }
            : { method: "addEventListener", value: "ended" },
        ),
        new URL(embedUrl).origin,
      );
    } catch {
      // A player that ignores the handshake simply never reports "ended";
      // the explicit "Mark complete & next" button still advances.
    }
  }

  return (
    <iframe
      ref={iframeRef}
      onLoad={subscribeToEnded}
      src={embedUrl}
      title={title}
      className="aspect-video w-full"
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
    />
  );
}
