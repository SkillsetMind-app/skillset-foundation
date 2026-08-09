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
export function VideoWatermark({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [timestamp, setTimestamp] = useState("");

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

    return () => window.clearInterval(intervalId);
  }, []);

  const viewerLabel =
    user?.email
    || user?.displayName
    || "SkillsetMind learner";
  const watermarkText = `${viewerLabel} - ${timestamp || "Protected playback"}`;

  return (
    <div className="relative overflow-hidden rounded-[10px] bg-[var(--color-primary)]">
      {children}
      {/* pointer-events-none so the overlay never steals a click from the
          player controls underneath — including the iframe ones. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute right-3 top-3 max-w-[70%] rounded-[8px] bg-[rgba(255,255,255,0.72)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgba(15,39,68,0.72)] shadow-sm backdrop-blur">
          {watermarkText}
        </div>
        <div className="absolute bottom-3 left-3 rounded-[8px] bg-[rgba(15,39,68,0.62)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/80">
          SkillsetMind protected playback
        </div>
      </div>
    </div>
  );
}

export function WatermarkedVideoPlayer({
  fileName,
  src,
}: {
  fileName: string;
  src: string;
}) {
  return (
    <div className="mt-3">
      <VideoWatermark>
        <video
          aria-label={fileName}
          className="aspect-video w-full bg-[var(--color-primary)]"
          controls
          controlsList="nodownload"
          src={src}
        />
      </VideoWatermark>
    </div>
  );
}
