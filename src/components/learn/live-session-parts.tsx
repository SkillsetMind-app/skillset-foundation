"use client";

import { CalendarPlus, Download, Radio } from "lucide-react";
import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  buildEventIcs,
  buildGoogleCalendarUrl,
  CALENDAR_EVENT_MINUTES,
  getEventLiveState,
  pickClosestEvent,
  type CourseEvent,
  type CourseEventType,
} from "@/domain/course-event";
import { getSafeExternalUrl } from "@/domain/external-url";

// A clock that ticks every 30 s (the same pace as the community): "starts in 12
// min" and "live" change without reloading. For display only.
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// One single sentence for "no link", on the four screens (there used to be four different ones). A
// deadline is not a meeting: it says so, with no "Join" or "link unavailable".
export function noJoinLinkKey(type: CourseEventType): string {
  return type === "deadline" ? "platform.events.deadlineNoLink" : "platform.events.linkUnavailable";
}

// The .ics is generated in the browser; ExportTableButton has the same trick, but
// does not export it.
function downloadText(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // On the iPad the download starts after the click: revoking right away cancelled it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Add to Google Calendar" and "Download .ics". `joinUrl` only for those who can see the link. */
export function EventCalendarActions({ event, joinUrl }: { event: CourseEvent; joinUrl: string | null }) {
  const { t } = useTranslation();
  const googleUrl = buildGoogleCalendarUrl(event, joinUrl);

  if (!googleUrl) {
    return null;
  }

  function downloadIcs() {
    const ics = buildEventIcs(event, joinUrl, Date.now());
    if (ics) downloadText(ics, "live-session.ics", "text/calendar;charset=utf-8");
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="button-outline inline-flex items-center gap-2 px-4 py-2.5 text-sm"
        >
          <CalendarPlus size={16} aria-hidden />
          {t("learnWave2.calendar.google")}
        </a>
        <button
          type="button"
          onClick={downloadIcs}
          className="button-outline inline-flex items-center gap-2 px-4 py-2.5 text-sm"
        >
          <Download size={16} aria-hidden />
          {t("learnWave2.calendar.ics")}
        </button>
      </div>
      <p className="text-xs text-[var(--color-ink-soft)]">
        {t("learnWave2.calendar.duration").replace("{minutes}", () => String(CALENDAR_EVENT_MINUTES))}
      </p>
    </div>
  );
}

// The strip at the top of the classroom, on ALL tabs: "Live now: X — Join" or "Starts
// in 12 min: X — Join". Before, at the crucial moment, the lessons tab said nothing and the
// join button was hidden in the sessions tab. The screen reader notice
// changes only when the state changes (starting / live), never on every
// minute of the countdown: that is why the visible line stays outside it.
export function ClassroomLiveStrip({ events }: { events: CourseEvent[] }) {
  const { t } = useTranslation();
  const now = useNow();
  // Two sessions close to each other: the one starting closest to now (the one at
  // 7:30 at 7:20, not the 6:00 webinar that still counts as "live").
  const session = pickClosestEvent(
    events.filter((event) => {
      if (event.status !== "scheduled" || event.type === "deadline") return false;
      const state = getEventLiveState(event.startsAt, now);
      return state === "startingSoon" || state === "live";
    }),
    now,
  );
  const live = session ? getEventLiveState(session.startsAt, now) === "live" : false;
  // The title last: a "{count}" inside it stays literal.
  const minutes = session ? Math.max(1, Math.ceil((Date.parse(session.startsAt) - now) / 60_000)) : 0;
  const withTitle = (key: string) =>
    session ? t(key).replace("{count}", () => String(minutes)).replace("{title}", () => session.title) : "";
  const announce = withTitle(live ? "learnWave2.agenda.stripLive" : "learnWave2.agenda.stripSoonAnnounce");
  const visible = live ? announce : withTitle("learnWave2.agenda.stripSoon");
  const joinUrl = session ? getSafeExternalUrl(session.externalUrl) : null;

  return (
    <>
      <p role="status" className="sr-only">
        {announce}
      </p>
      {session ? (
        <div className="member-live-strip flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-success-fg)] bg-[var(--color-success-soft)] px-4 py-2.5">
          <p aria-hidden="true" className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
            <Radio size={16} className="shrink-0 text-[var(--color-success-fg)]" />
            <span className="min-w-0">{visible}</span>
          </p>
          {joinUrl ? (
            // The visible title stays out of the accessibility tree: the link's
            // name carries the title, otherwise the screen reader heard only "Join".
            <a
              href={joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("learnWave2.agenda.stripJoinLabel").replace("{title}", () => session.title)}
              className="button-solid inline-flex items-center px-4 text-sm"
            >
              {t("learnWave2.agenda.stripJoin")}
            </a>
          ) : (
            <span className="text-xs text-[var(--color-ink-soft)]">{t(noJoinLinkKey(session.type))}</span>
          )}
        </div>
      ) : null}
    </>
  );
}
