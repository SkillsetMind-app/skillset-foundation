"use client";

import { Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { Lesson } from "@/domain/learning";
import { useTranslation } from "@/components/i18n/i18n-provider";

const COUNTDOWN_SECONDS = 5;
/** The notice enters the live region a moment AFTER it exists. */
const ANNOUNCE_DELAY_MS = 50;
/** Must match the transition of `.member-next-lesson.is-leaving`
 *  (--duration-base, the system's standard time). */
const EXIT_MS = 180;

// The "Next lesson" card that slides up over the video when it ends.
//
// POR QUE ISTO EXISTE
//
// The automatic advance already existed — it just happened in silence: the lesson changed with no
// notice, no "cancel", and the next video loaded but did not play. If the
// learner had scrolled down to the discussion, the switch happened off screen: they
// came back and found another video, without knowing why.
//
// Here: the next lesson's title, a 5 s countdown with a ring, "Watch now" and
// "Cancel". With no action, the next one starts (the parent switches the lesson and asks for autoplay).
//
// Entry and exit belong to the card, not the parent: it slides up (CSS) and, on
// cancel, sets `is-leaving`, slides down, and ONLY THEN notifies the parent — which
// unmounts it. Without this the card disappeared in the same frame it appeared.
export function NextLessonCard({
  lesson,
  onCancel,
  onPlay,
}: {
  lesson: Lesson;
  onCancel: () => void;
  onPlay: () => void;
}) {
  const { t } = useTranslation();
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [leaving, setLeaving] = useState(false);
  // A live region that is born with its text is often not read (NVDA/JAWS
  // announce CHANGES): it mounts empty and the text arrives 50ms later. Its own
  // timer, separate from the countdown and the navigation.
  const [announced, setAnnounced] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnounced(true), ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Leaving: the countdown stops (otherwise the falling card would still switch lessons) and
  // the parent only unmounts when the animation ends.
  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = window.setTimeout(onCancel, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, onCancel]);

  useEffect(() => {
    if (leaving) {
      return;
    }

    if (secondsLeft <= 0) {
      onPlay();
      return;
    }

    const timer = window.setTimeout(
      () => setSecondsLeft((current) => current - 1),
      1000,
    );

    return () => window.clearTimeout(timer);
  }, [leaving, secondsLeft, onPlay]);

  const progress = 1 - secondsLeft / COUNTDOWN_SECONDS;

  // Notice for the screen reader: ONCE, when the card appears. Before, the whole card
  // was aria-live and the number changed every second, so the reader
  // re-read the card five times. The text uses the initial count (a constant),
  // not `secondsLeft`, so it does not change on every tick; the visible countdown stays
  // outside the accessibility tree.
  const announcement = t("learn.classroom.nextLesson.announce")
    .replace("{seconds}", () => String(COUNTDOWN_SECONDS))
    .replace("{title}", () => lesson.title);

  // A labeled region, not a dialog: the card does not trap focus or block the
  // video, and "dialog" promised the screen reader a window that does not exist.
  return (
    <div
      role="region"
      aria-label={t("learn.classroom.nextLesson.title")}
      className={`member-next-lesson ${leaving ? "is-leaving" : ""} absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-center gap-3 sm:flex-nowrap rounded-lg bg-[rgba(15,39,68,0.92)] p-3 text-white shadow-[0_18px_36px_rgba(15,39,68,0.35)] backdrop-blur sm:inset-x-auto sm:right-3 sm:max-w-[360px]`}
    >
      <div
        aria-hidden="true"
        className="member-next-lesson__ring grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums"
        style={{
          background: `conic-gradient(var(--ma-accent, var(--color-accent)) ${Math.round(progress * 360)}deg, rgba(255,255,255,0.18) 0deg)`,
        }}
      >
        <span className="grid size-8 place-items-center rounded-full bg-[rgba(15,39,68,0.95)]">
          {secondsLeft}
        </span>
      </div>
      <p className="sr-only" role="status">
        {announced ? announcement : ""}
      </p>
      {/* basis-28 + flex-wrap: on the phone the title got 63 to 103px on a
          single line ("1.2 What Em…"). Now it takes the line, in up to two
          lines, and the buttons drop down to the right. From sm up the card
          fits its content and does not wrap (sm:flex-nowrap): with a short
          title the buttons dropped down for no reason. */}
      <div className="min-w-0 flex-1 basis-28">
        {/* The countdown stays only in the ring; here, a static "Next lesson" (the same
            name as the region, so it is outside the accessibility tree). */}
        <p aria-hidden="true" className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">
          {t("learn.classroom.nextLesson.title")}
        </p>
        <p className="line-clamp-2 break-words text-sm font-semibold">{lesson.title}</p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* button-solid: in the room it paints with the course color and the text
            it asks for (--ma-accent / --ma-on-accent). The platform gold
            with white text gave 2.56:1. */}
        <button
          type="button"
          onClick={onPlay}
          className="button-solid inline-flex min-h-11 items-center gap-1.5 px-3 text-xs font-bold"
        >
          <Play aria-hidden="true" size={14} strokeWidth={2.5} />
          {t("learn.classroom.nextLesson.watch")}
        </button>
        <button
          type="button"
          onClick={() => setLeaving(true)}
          aria-label={t("learn.classroom.nextLesson.cancel")}
          className="grid size-11 place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X aria-hidden="true" size={16} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
