"use client";

import { useEffect, useState } from "react";

type WatermarkedVideoPlayerProps = {
  fileName: string;
  src: string;
  viewerLabel: string;
};

export function WatermarkedVideoPlayer({
  fileName,
  src,
  viewerLabel,
}: WatermarkedVideoPlayerProps) {
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

  const watermarkText = `${viewerLabel || "SkillsetMind learner"} - ${timestamp || "Protected playback"}`;

  return (
    <div className="relative mt-3 overflow-hidden rounded-[10px] bg-[var(--color-primary)]">
      <video
        aria-label={fileName}
        className="aspect-video w-full bg-[var(--color-primary)]"
        controls
        controlsList="nodownload"
        src={src}
      />
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
