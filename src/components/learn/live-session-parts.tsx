"use client";

import { CalendarPlus, Download, Radio } from "lucide-react";
import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  buildEventIcs,
  buildGoogleCalendarUrl,
  CALENDAR_EVENT_MINUTES,
  getEventLiveState,
  type CourseEvent,
  type CourseEventType,
} from "@/domain/course-event";
import { getSafeExternalUrl } from "@/domain/external-url";

// Relógio que anda a cada 30 s (o mesmo ritmo da comunidade): "começa em 12
// min" e "ao vivo" mudam sem recarregar. Só para exibir.
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// Uma frase só para "sem link", nas quatro telas (eram quatro diferentes). O
// prazo (deadline) não é reunião: diz isso, sem "Join" nem "link indisponível".
export function noJoinLinkKey(type: CourseEventType): string {
  return type === "deadline" ? "platform.events.deadlineNoLink" : "platform.events.linkUnavailable";
}

// O .ics é gerado no navegador; o ExportTableButton tem o mesmo truque, mas
// não o exporta.
function downloadText(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** "Add to Google Calendar" e "Download .ics". `joinUrl` só para quem pode ver o link. */
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

// A faixa do topo da sala, em TODAS as abas: "Live now: X — Join" ou "Starts
// in 12 min: X — Join". Antes, na hora H, a aba das aulas não dizia nada e o
// botão de entrar ficava escondido na aba das sessões. O aviso de leitor de
// tela muda só quando o estado muda (começando / ao vivo), nunca a cada
// minuto da contagem: por isso a linha visível fica fora dele.
export function ClassroomLiveStrip({ events }: { events: CourseEvent[] }) {
  const { t } = useTranslation();
  const now = useNow();
  const session = events.find((event) => {
    if (event.status !== "scheduled" || event.type === "deadline") return false;
    const state = getEventLiveState(event.startsAt, now);
    return state === "startingSoon" || state === "live";
  });
  const live = session ? getEventLiveState(session.startsAt, now) === "live" : false;
  // O título por último: um "{count}" dentro dele fica literal.
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
            <a
              href={joinUrl}
              target="_blank"
              rel="noopener noreferrer"
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
