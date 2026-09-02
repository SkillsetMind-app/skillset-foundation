"use client";

import { Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { Lesson } from "@/domain/learning";

const COUNTDOWN_SECONDS = 5;

// O cartão "Próxima aula" que sobe sobre o vídeo quando ele termina.
//
// POR QUE ISTO EXISTE
//
// O avanço automático já existia — só acontecia em silêncio: a aula mudava sem
// aviso, sem "cancelar", e o próximo vídeo carregava mas não tocava. Se o
// aluno tinha rolado até a discussão, a troca acontecia fora da tela: ele
// voltava e encontrava outro vídeo, sem saber por quê.
//
// Aqui: título da próxima aula, contagem de 5 s com anel, "Assistir agora" e
// "Cancelar". Sem ação, a próxima começa (o pai troca a aula e pede autoplay).
export function NextLessonCard({
  lesson,
  onCancel,
  onPlay,
}: {
  lesson: Lesson;
  onCancel: () => void;
  onPlay: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onPlay();
      return;
    }

    const timer = window.setTimeout(
      () => setSecondsLeft((current) => current - 1),
      1000,
    );

    return () => window.clearTimeout(timer);
  }, [secondsLeft, onPlay]);

  const progress = 1 - secondsLeft / COUNTDOWN_SECONDS;

  return (
    <div
      role="dialog"
      aria-label="Next lesson"
      aria-live="polite"
      className="member-next-lesson absolute inset-x-3 bottom-3 z-10 flex items-center gap-3 rounded-[12px] bg-[rgba(15,39,68,0.92)] p-3 text-white shadow-[0_18px_36px_rgba(15,39,68,0.35)] backdrop-blur sm:inset-x-auto sm:right-3 sm:max-w-[360px]"
    >
      <div
        aria-hidden="true"
        className="member-next-lesson__ring grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums"
        style={{
          background: `conic-gradient(var(--color-accent) ${Math.round(progress * 360)}deg, rgba(255,255,255,0.18) 0deg)`,
        }}
      >
        <span className="grid size-8 place-items-center rounded-full bg-[rgba(15,39,68,0.95)]">
          {secondsLeft}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
          {`Next lesson in ${secondsLeft}s`}
        </p>
        <p className="truncate text-sm font-semibold">{lesson.title}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onPlay}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[var(--color-accent)] px-3 text-xs font-bold text-white"
        >
          <Play aria-hidden="true" size={14} strokeWidth={2.5} />
          Watch now
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="grid size-11 place-items-center rounded-[10px] text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X aria-hidden="true" size={16} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
