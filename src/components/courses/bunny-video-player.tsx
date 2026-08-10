"use client";

import { PlayCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type BunnyVideoPlayerProps = {
  title: string;
  /**
   * Fires when Bunny reports the clip finished, so the classroom can
   * auto-advance. Defensive by construction: we accept a message only from
   * this iframe's own window AND its exact origin, and ignore any payload that
   * is not the "ended" event.
   *
   * UNVERIFIED against Bunny's docs from inside this repo — the embed speaks
   * the player.js protocol, so we subscribe with player.js's addEventListener
   * message. If Bunny never answers, this is a silent no-op and the explicit
   * "Mark complete & next" button still advances the student.
   */
  onEnded?: () => void;
} & (
  | {
      assetId: string;
      courseId?: never;
      lessonId?: never;
    }
  | {
      assetId?: never;
      courseId: string;
      lessonId: string;
    }
);

export function BunnyVideoPlayer(props: BunnyVideoPlayerProps) {
  const [playback, setPlayback] = useState<{
    key: string;
    embedUrl: string | null;
    error: string;
  }>({ key: "", embedUrl: null, error: "" });
  const assetId = "assetId" in props ? props.assetId : undefined;
  const courseId = "courseId" in props ? props.courseId : undefined;
  const lessonId = "lessonId" in props ? props.lessonId : undefined;
  const requestKey = assetId
    ? `asset:${assetId}`
    : `preview:${courseId}:${lessonId}`;
  const currentPlayback = playback.key === requestKey
    ? playback
    : { key: requestKey, embedUrl: null, error: "" };
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onEnded = props.onEnded;
  const embedUrl = currentPlayback.embedUrl;

  useEffect(() => {
    if (!embedUrl || !onEnded) {
      return;
    }

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

      const name = (payload as { event?: unknown } | null)?.event;

      if (name === "ended" || name === "finish") {
        onEnded?.();
      }
    }

    window.addEventListener("message", handleMessage);

    return () => window.removeEventListener("message", handleMessage);
  }, [embedUrl, onEnded]);

  function subscribeToEnded() {
    if (!embedUrl || !onEnded) {
      return;
    }

    try {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({
          context: "player.js",
          method: "addEventListener",
          value: "ended",
          listener: "ended",
        }),
        new URL(embedUrl).origin,
      );
    } catch {
      // A player that does not speak player.js just never answers.
    }
  }

  useEffect(() => {
    let active = true;
    const body = assetId
      ? { assetId }
      : { courseId, lessonId };

    fetch("/api/courses/video-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(String(response.status))),
      )
      .then((data: { embedUrl: string }) => {
        if (active) {
          setPlayback({ key: requestKey, embedUrl: data.embedUrl, error: "" });
        }
      })
      .catch(() => {
        if (active) {
          setPlayback({
            key: requestKey,
            embedUrl: null,
            error: "We could not load this video. Refresh and try again.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [assetId, courseId, lessonId, requestKey]);

  if (currentPlayback.error) {
    return (
      <div className="member-video-empty">
        <PlayCircle size={34} aria-hidden />
        <h5>Video unavailable</h5>
        <p>{currentPlayback.error}</p>
      </div>
    );
  }

  if (!currentPlayback.embedUrl) {
    return (
      <div className="member-video-empty">
        <PlayCircle size={34} aria-hidden />
        <h5>Loading video...</h5>
        <p>Preparing playback.</p>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      onLoad={subscribeToEnded}
      src={currentPlayback.embedUrl}
      title={props.title}
      className="aspect-video w-full"
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
    />
  );
}
