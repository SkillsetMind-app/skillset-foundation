"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";

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
  const [timestamp, setTimestamp] = useState("");
  // Uma etiqueta só, que muda de canto a cada ~30 s. Antes eram duas fixas o
  // tempo todo (e-mail e hora no canto superior, "protected playback" no
  // inferior). Uma etiqueta pequena e translúcida que passeia pelos quatro
  // cantos continua carimbando a gravação inteira — o objetivo anti-pirataria —
  // e atrapalha menos quem está assistindo.
  const [corner, setCorner] = useState(0);

  useEffect(() => {
    function updateTimestamp() {
      setTimestamp(
        new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date()),
      );
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
    || `${brandName} learner`;
  const watermarkText = `${viewerLabel} · ${timestamp || "protected playback"} · ${brandName}`;

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

export function WatermarkedVideoPlayer({
  brandName,
  fileName,
  onEnded,
  src,
}: {
  brandName?: string;
  fileName: string;
  /** Fires when the clip plays to the end — the auto-advance signal for the
   *  native player (the iframe backends have to hand-roll their own). */
  onEnded?: () => void;
  src: string;
}) {
  return (
    <div className="mt-3">
      <VideoWatermark brandName={brandName}>
        <video
          aria-label={fileName}
          className="aspect-video w-full bg-[var(--color-primary)]"
          controls
          controlsList="nodownload"
          onEnded={onEnded}
          src={src}
        />
      </VideoWatermark>
    </div>
  );
}
