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
  // Uma etiqueta só, que muda de canto a cada ~30 s. Antes eram duas fixas o
  // tempo todo (e-mail e hora no canto superior, "protected playback" no
  // inferior). Uma etiqueta pequena e translúcida que passeia pelos quatro
  // cantos continua carimbando a gravação inteira — o objetivo anti-pirataria —
  // e atrapalha menos quem está assistindo.
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

  const viewerLabel =
    user?.email
    || user?.displayName
    || t("courseMedia.watermark.learner").replace("{brandName}", () => brandName);
  const timestampLabel = timestamp === null
    ? t("courseMedia.watermark.protectedPlayback")
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
  const watermarkText = `${viewerLabel} · ${timestampLabel} · ${brandName}`;

  return (
    <div className="relative overflow-hidden rounded-[10px] bg-[var(--color-primary)]">
      {children}
      {/* pointer-events-none so the overlay never steals a click from the
          player controls underneath — including the iframe ones. */}
      <div className="pointer-events-none absolute inset-0">
        <div
          data-watermark-corner={corner}
          className={`absolute max-w-[70%] rounded-[6px] bg-[rgba(15,39,68,0.38)] px-2 py-0.5 text-[10px] font-medium tracking-[0.04em] text-white/70 backdrop-blur-[2px] ${watermarkCorners[corner]}`}
        >
          {watermarkText}
        </div>
      </div>
    </div>
  );
}

const watermarkCorners = [
  "right-3 top-3",
  "bottom-3 right-3",
  "bottom-3 left-3",
  "left-3 top-3",
] as const;

/** De quantos em quantos segundos a posição vai para o armazenamento. O evento
 *  `timeupdate` dispara ~4x por segundo; gravar em todos é desperdício. */
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
  /** "Esta pessoa, nesta aula" (lessonPositionRef). Sem ela o vídeo
   *  simplesmente começa do zero, como antes. */
  resume?: LessonPositionRef | null;
  src: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSavedRef = useRef(0);
  // Espelho da posição atual: no desmonte (trocar de aula, sair da sala) o
  // elemento já pode ter ido embora, e é justamente aí que a última gravação
  // importa mais.
  const positionRef = useRef({ seconds: 0, duration: 0 });

  useEffect(() => {
    lastSavedRef.current = 0;
    positionRef.current = { seconds: 0, duration: 0 };
    // Abrir a aula já é o evento do funil: quem desiste no meio não deixava
    // rastro nenhum, porque `lesson_progress` só nasce na conclusão.
    markLessonOpened(resume);

    return () => {
      const { seconds, duration } = positionRef.current;
      saveLessonPosition(resume, seconds, duration);
    };
  }, [resume, src]);

  function handleLoadedMetadata() {
    // A posição vem do banco (atravessa aparelhos) e por isso chega depois do
    // metadado. Guardar QUAL aula pediu: se o aluno trocou de aula enquanto a
    // resposta vinha, ela não vale mais.
    const pedido = resume;

    void readLessonPosition(pedido).then((seconds) => {
      const video = videoRef.current;

      // `seconds < duration` é o corta-circuito: uma posição de outra gravação
      // da mesma aula (o professor regravou) não pode jogar o aluno para fora
      // da linha do tempo.
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
    // Terminou: não há posição a guardar, e o desmonte não deve ressuscitá-la.
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
