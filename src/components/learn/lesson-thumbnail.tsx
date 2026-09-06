"use client";

import { useState } from "react";

// URLs are validated once when projecting the course's authorized assets.
export function LessonThumbnail({ src }: { src?: string }) {
  return src ? <ThumbnailImage key={src} src={src} /> : null;
}

function ThumbnailImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      width={64}
      height={40}
      className="h-10 w-16 shrink-0 rounded-md object-cover"
      onError={() => setFailed(true)}
    />
  );
}
