"use client";

import { PlayCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  clearLessonPosition,
  readLessonPosition,
  saveLessonPosition,
} from "@/lib/learn/lesson-position";

/** Igual ao player nativo: uma gravação a cada ~10 s de reprodução. */
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
  /** A aula abriu pelo cartão "Próxima aula": o embed começa a tocar sozinho
   *  (permitido porque o aluno já interagiu com a página). */
  autoplay?: boolean;
  /**
   * Chave de "onde esta pessoa parou nesta aula" (lessonPositionKey). Vai pelo
   * MESMO aperto de mão player.js que já traz o "ended": pedimos `timeupdate`
   * e devolvemos `setCurrentTime`. Player que não fala o protocolo nunca
   * responde, nada é guardado e nada é buscado — o vídeo começa do zero, como
   * antes. Não verificado contra a documentação da Bunny a partir deste repo.
   */
  resumeKey?: string | null;
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
  const resumeKey = props.resumeKey ?? null;
  const embedUrl = currentPlayback.embedUrl;
  const lastSavedRef = useRef(0);
  // Buscar a posição UMA vez, e só depois que o player provou estar vivo (o
  // primeiro `timeupdate`). Mandar `setCurrentTime` no `onLoad` chega antes de
  // o vídeo existir e se perde no caminho.
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

    function post(message: Record<string, unknown>) {
      try {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ context: "player.js", ...message }),
          embedOrigin,
        );
      } catch {
        // idem: player que não fala player.js nunca responde.
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
        lastSavedRef.current = 0;
        clearLessonPosition(resumeKey);
        onEnded?.();
        return;
      }

      if (name !== "timeupdate" || !resumeKey) {
        return;
      }

      // player.js manda o payload em `value`; algumas builds usam `data`.
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
        const saved = readLessonPosition(resumeKey);

        if (saved > 0 && (!Number.isFinite(duration) || saved < duration)) {
          post({ method: "setCurrentTime", value: saved });
          return;
        }
      }

      if (Math.abs(seconds - lastSavedRef.current) < SAVE_EVERY_SECONDS) {
        return;
      }

      lastSavedRef.current = seconds;
      saveLessonPosition(resumeKey, seconds, duration);
    }

    window.addEventListener("message", handleMessage);

    return () => window.removeEventListener("message", handleMessage);
  }, [embedUrl, onEnded, resumeKey]);

  useEffect(() => {
    resumedRef.current = false;
    lastSavedRef.current = 0;
  }, [embedUrl, resumeKey]);

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
