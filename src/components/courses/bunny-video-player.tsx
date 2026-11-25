"use client";

import { Loader2, PlayCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui";

import {
  clearLessonPosition,
  markLessonOpened,
  readLessonPosition,
  saveLessonPosition,
  type LessonPositionRef,
} from "@/lib/learn/lesson-position";

/** Same as the native player: one save every ~10 s of playback. */
const SAVE_EVERY_SECONDS = 10;

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
  /** The lesson opened from the "Next lesson" card: the embed starts playing on its own
   *  (allowed because the learner has already interacted with the page). */
  autoplay?: boolean;
  /**
   * "This person, in this lesson" (lessonPositionRef). It goes through the SAME player.js
   * handshake that already brings the "ended": we ask for `timeupdate` and send back
   * `setCurrentTime`. A player that does not speak the protocol never answers, nothing is
   * saved and nothing is fetched — the video starts from zero, as before. Not
   * verified against Bunny's documentation from this repo.
   */
  resume?: LessonPositionRef | null;
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

// Bunny's embed honors `autoplay=true` in the query. Only appended when the
// classroom asks for it (the lesson opened from the "Next lesson" card).
export function withAutoplay(embedUrl: string, autoplay?: boolean): string {
  if (!autoplay) {
    return embedUrl;
  }

  try {
    const url = new URL(embedUrl);
    url.searchParams.set("autoplay", "true");
    return url.toString();
  } catch {
    return embedUrl;
  }
}

export function BunnyVideoPlayer(props: BunnyVideoPlayerProps) {
  const { t } = useTranslation();
  const [playback, setPlayback] = useState<{
    key: string;
    embedUrl: string | null;
    error: boolean;
  }>({ key: "", embedUrl: null, error: false });
  const assetId = "assetId" in props ? props.assetId : undefined;
  const courseId = "courseId" in props ? props.courseId : undefined;
  const lessonId = "lessonId" in props ? props.lessonId : undefined;
  const requestKey = assetId
    ? `asset:${assetId}`
    : `preview:${courseId}:${lessonId}`;
  const currentPlayback = playback.key === requestKey
    ? playback
    : { key: requestKey, embedUrl: null, error: false };
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onEnded = props.onEnded;
  const resume = props.resume ?? null;
  const embedUrl = currentPlayback.embedUrl;
  const lastSavedRef = useRef(0);
  // Fetch the position ONCE, and only after the player has proven to be alive (the
  // first `timeupdate`). Sending `setCurrentTime` in `onLoad` arrives before
  // the video exists and is lost on the way.
  const resumedRef = useRef(false);

  useEffect(() => {
    if (!embedUrl) {
      return;
    }

    let embedOrigin: string;

    try {
      embedOrigin = new URL(embedUrl).origin;
    } catch {
      return;
    }

    // The position now comes from the database, so it arrives AFTER the first
    // `timeupdate`. Until it arrives nothing is saved: the video is still
    // at second zero, and saving zero would erase exactly the point we are
    // fetching. `cancelado` covers a lesson switch with the response in flight.
    let cancelado = false;
    let esperandoPosicao = false;

    function post(message: Record<string, unknown>) {
      try {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ context: "player.js", ...message }),
          embedOrigin,
        );
      } catch {
        // same: a player that does not speak player.js never answers.
      }
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

      const message = payload as
        | { event?: unknown; value?: unknown; data?: unknown }
        | null;
      const name = message?.event;

      if (name === "ended" || name === "finish") {
        resumedRef.current = true;
        esperandoPosicao = false;
        lastSavedRef.current = 0;
        clearLessonPosition(resume);
        onEnded?.();
        return;
      }

      if (name !== "timeupdate" || !resume) {
        return;
      }

      // player.js sends the payload in `value`; some builds use `data`.
      const detail = (message?.value ?? message?.data) as
        | { seconds?: unknown; duration?: unknown }
        | null;
      const seconds = Number(detail?.seconds);
      const duration = Number(detail?.duration);

      if (!Number.isFinite(seconds)) {
        return;
      }

      if (!resumedRef.current) {
        resumedRef.current = true;
        esperandoPosicao = true;

        void readLessonPosition(resume).then((saved) => {
          esperandoPosicao = false;

          if (cancelado) {
            return;
          }

          if (saved > 0 && (!Number.isFinite(duration) || saved < duration)) {
            // Do not save again on the next beat what was just read.
            lastSavedRef.current = saved;
            post({ method: "setCurrentTime", value: saved });
          }
        });

        return;
      }

      if (esperandoPosicao) {
        return;
      }

      if (Math.abs(seconds - lastSavedRef.current) < SAVE_EVERY_SECONDS) {
        return;
      }

      lastSavedRef.current = seconds;
      saveLessonPosition(resume, seconds, duration);
    }

    window.addEventListener("message", handleMessage);

    return () => {
      cancelado = true;
      window.removeEventListener("message", handleMessage);
    };
  }, [embedUrl, onEnded, resume]);

  useEffect(() => {
    resumedRef.current = false;
    lastSavedRef.current = 0;
    // Opening the lesson is already the funnel event: whoever gives up halfway left
    // no trace at all, because `lesson_progress` is only born on completion.
    markLessonOpened(resume);
  }, [embedUrl, resume]);

  function subscribeToPlayerEvents() {
    if (!embedUrl) {
      return;
    }

    try {
      const origin = new URL(embedUrl).origin;

      for (const name of ["ended", "timeupdate"]) {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({
            context: "player.js",
            method: "addEventListener",
            value: name,
            listener: name,
          }),
          origin,
        );
      }
    } catch {
      // A player that does not speak player.js just never answers.
    }
  }

  // A 404 is a real "no" (not bought, not open yet, or gone). Anything else —
  // the 503 a database blip returns, a 429, a dropped connection — can work on
  // a second try, so the student gets a button instead of a dead end.
  const [attempt, setAttempt] = useState(0);
  const [failedStatus, setFailedStatus] = useState<string | null>(null);

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
          setPlayback({ key: requestKey, embedUrl: data.embedUrl, error: false });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setFailedStatus(error instanceof Error ? error.message : null);
          setPlayback({
            key: requestKey,
            embedUrl: null,
            error: true,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [assetId, courseId, lessonId, requestKey, attempt]);

  if (currentPlayback.error) {
    const retryable = failedStatus !== "404" && failedStatus !== "401";
    return (
      <div className="member-video-empty">
        <PlayCircle size={34} aria-hidden />
        <h5>{t("courseMedia.preview.unavailable")}</h5>
        <p>{t("courseMedia.preview.videoError")}</p>
        {retryable ? (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              setPlayback({ key: requestKey, embedUrl: null, error: false });
              setAttempt((value) => value + 1);
            }}
          >
            {t("authFlow.loading.retry")}
          </Button>
        ) : null}
      </div>
    );
  }

  if (!currentPlayback.embedUrl) {
    // The same wait as the lesson box: 16:9 (the iframe below is aspect-video,
    // so nothing jumps when it arrives) and only the ring. The play icon with a
    // sentence looked like "no video"; the text is left for the screen reader.
    return (
      <div className="member-video-empty member-video-empty--loading" role="status">
        <Loader2 size={32} aria-hidden className="motion-safe:animate-spin" />
        <h5 className="sr-only">{t("courseMedia.preview.loading")}</h5>
        <p className="sr-only">{t("courseMedia.preview.preparingPlayback")}</p>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      onLoad={subscribeToPlayerEvents}
      src={withAutoplay(currentPlayback.embedUrl, props.autoplay)}
      title={props.title}
      className="aspect-video w-full"
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
    />
  );
}
