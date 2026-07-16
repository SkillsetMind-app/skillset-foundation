"use client";

import { PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";

type BunnyVideoPlayerProps = {
  title: string;
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
      src={currentPlayback.embedUrl}
      title={props.title}
      className="aspect-video w-full"
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
    />
  );
}
