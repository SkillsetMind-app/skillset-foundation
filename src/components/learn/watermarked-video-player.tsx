"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  clearLessonPosition,
  markLessonOpened,
  readLessonPosition,
  saveLessonPosition,
  type LessonPositionRef,
} from "@/lib/learn/lesson-position";

/**
 * Identity watermark over any lesson player — <video>, Bunny iframe, or
 * YouTube iframe. It stamps who is watching and when, so a re-recording
 * carries the leaker's own identity.
 *
 * ponytail: a watermark deters redistribution, it does not prevent capture.
 * Nothing rendered in a browser can. For real protection the lesson has to
 * come from Upload (Bunny signed playback), which is why the teacher-side
 * picker says so.
 */
export function VideoWatermark({
  children,
  brandName = "SkillsetMind",
}: {
  children: React.ReactNode;
  /** Whitelabel member areas stamp the teacher's name instead of ours. The
   *  watermark itself always stays — it is anti-piracy, not chrome. */
  brandName?: string;
}) {
  const { user } = useAuth();
  const { locale, t } = useTranslation();
  const [timestamp, setTimestamp] = useState<number | null>(null);
  // A single label that changes corner every ~30 s. Before, there were two
  // fixed ones all the time (email and time in the top corner, "protected
  // playback" in the bottom one). A small, translucent label that wanders
  // through the four corners still stamps the whole recording, which is the
  // anti-piracy goal, and bothers the person watching less.
  const [corner, setCorner] = useState(0);

  useEffect(() => {
    function updateTimestamp() {
      setTimestamp(Date.now());
    }

    updateTimestamp();
    const intervalId = window.setInterval(updateTimestamp, 60_000);
    const cornerId = window.setInterval(
      () => setCorner((current) => (current + 1) % watermarkCorners.length),
      30_000,
    );

    return () => {
      window.clearInterval(intervalId);
      window.clearInterval(cornerId);
    };
  }, []);

  // A short account code, never the email or the name: the viewer does not
  // need to see their own personal data on screen, and the staff can still
  // find the account of whoever leaked a recording from the start of the uid.
  const viewerCode = viewerCodeFromUid(user?.uid);
  const viewerLabel = viewerCode
    ? `ID ${viewerCode}`
    : t("courseMedia.watermark.learner").replace("{brandName}", () => brandName);
  const timestampLabel = timestamp === null
    ? t("courseMedia.watermark.protectedPlayback")
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
  const watermarkText = `${viewerLabel} · ${timestampLabel} · ${brandName}`;

  return (
    <div className="relative overflow-hidden rounded-md bg-[var(--color-primary)]">
      {children}
      {/* pointer-events-none so the overlay never steals a click from the
          player controls underneath — including the iframe ones. */}
      <div className="pointer-events-none absolute inset-0">
        <div
          data-watermark-corner={corner}
          className={`absolute max-w-[70%] rounded-chip bg-[rgba(15,39,68,0.38)] px-2 py-0.5 text-[10px] font-medium tracking-[0.04em] text-white/70 backdrop-blur-[2px] ${watermarkCorners[corner]}`}
        >
          {watermarkText}
        </div>
      </div>
    </div>
  );
}

/** "4f3a92c1-…" → "4F3A-92C1". */
export function viewerCodeFromUid(uid: string | null | undefined): string | null {
  const compact = (uid ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  if (compact.length < 8) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

const watermarkCorners = [
  "right-3 top-3",
  "bottom-3 right-3",
  "bottom-3 left-3",
  "left-3 top-3",
] as const;

/** How many seconds apart the position is sent to storage. The `timeupdate`
 *  event fires ~4x per second; saving on every one is wasteful. */
const SAVE_EVERY_SECONDS = 10;

export function WatermarkedVideoPlayer({
  brandName,
  fileName,
  onEnded,
  resume = null,
  src,
}: {
  brandName?: string;
  fileName: string;
  /** Fires when the clip plays to the end — the auto-advance signal for the
   *  native player (the iframe backends have to hand-roll their own). */
  onEnded?: () => void;
  /** "This person, in this lesson" (lessonPositionRef). Without it the video
   *  simply starts from zero, as before. */
  resume?: LessonPositionRef | null;
  src: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSavedRef = useRef(0);
  // Mirror of the current position: on unmount (switching lessons, leaving
  // the room) the element may already be gone, and that is exactly when the
  // last save matters most.
  const positionRef = useRef({ seconds: 0, duration: 0 });

  useEffect(() => {
    lastSavedRef.current = 0;
    positionRef.current = { seconds: 0, duration: 0 };
    // Opening the lesson is already the funnel event: someone who quits midway
    // used to leave no trace, because `lesson_progress` is only created on
    // completion.
    markLessonOpened(resume);

    return () => {
      const { seconds, duration } = positionRef.current;
      saveLessonPosition(resume, seconds, duration);
    };
  }, [resume, src]);

  function handleLoadedMetadata() {
    // The position comes from the database (it crosses devices) and so it
    // arrives after the metadata. Remember WHICH lesson asked: if the learner
    // switched lessons while the response was on its way, it no longer applies.
    const pedido = resume;

    void readLessonPosition(pedido).then((seconds) => {
      const video = videoRef.current;

      // `seconds < duration` is the circuit breaker: a position from another
      // recording of the same lesson (the teacher re-recorded it) must not
      // throw the learner outside the timeline.
      if (video && pedido === resume && seconds > 0 && seconds < video.duration) {
        video.currentTime = seconds;
      }
    });
  }

  function handleTimeUpdate() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    positionRef.current = { seconds: video.currentTime, duration: video.duration };

    if (Math.abs(video.currentTime - lastSavedRef.current) < SAVE_EVERY_SECONDS) {
      return;
    }

    lastSavedRef.current = video.currentTime;
    saveLessonPosition(resume, video.currentTime, video.duration);
  }

  function handleEnded() {
    // It finished: there is no position to save, and the unmount must not bring it back.
    positionRef.current = { seconds: 0, duration: 0 };
    lastSavedRef.current = 0;
    clearLessonPosition(resume);
    onEnded?.();
  }

  return (
    <div className="mt-3">
      <VideoWatermark brandName={brandName}>
        <video
          ref={videoRef}
          aria-label={fileName}
          className="aspect-video w-full bg-[var(--color-primary)]"
          controls
          controlsList="nodownload"
          onEnded={handleEnded}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          src={src}
        />
      </VideoWatermark>
    </div>
  );
}
