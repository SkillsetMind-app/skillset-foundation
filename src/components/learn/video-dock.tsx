"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * On a phone, scrolling the room to read the description or the discussion
 * made the video disappear from the screen: pause, scroll back up, find the
 * spot, scroll down again. Once the player is scrolled past, the frame pins to
 * the top of the screen, small, with the lesson name and an X. Scroll back and
 * it returns to full size on its own.
 *
 * THE RULE that shapes the design: the video NEVER moves in the DOM. An iframe
 * that is pulled out and put back reloads, and the lesson would restart from
 * zero. Here only a class goes on and off; the CSS does the pinning and
 * shrinking (globals.css, .member-video-dock--mini, inside
 * @media (max-width: 767.98px)). React unmounts nothing, on the phone or on the
 * computer.
 *
 * Above 768px the state is still computed, but the mini CSS lives entirely
 * inside the media query: the class is inert.
 */
export function VideoDock({
  children,
  closeLabel = "Close mini player",
  enabled = true,
  title,
}: {
  children: ReactNode;
  closeLabel?: string;
  /** A lesson without video (text, media not attached yet, locked lesson) has
   *  nothing to pin to the top: only the empty frame would go up with it. */
  enabled?: boolean;
  title: string;
}) {
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [scrolledPast, setScrolledPast] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // The frame leaves the flow when it pins; without reserving its height, the
  // whole page jumps up the moment the mini turns on.
  const [reservedHeight, setReservedHeight] = useState(0);

  useEffect(() => {
    const dock = dockRef.current;

    if (!enabled || !dock || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return;
        }

        // `top < 0` is what separates "I scrolled past the video" from "I have
        // not reached it yet": reaching the page footer must not turn the mini
        // on, and neither must the first reading with the room off screen.
        const next = !entry.isIntersecting && entry.boundingClientRect.top < 0;

        if (next && entry.boundingClientRect.height > 0) {
          setReservedHeight(entry.boundingClientRect.height);
        }

        // Closing lasts until the video comes back on screen, not forever.
        // Whoever closes it wants quiet now, not to turn the feature off. The
        // reset lives here, in the observer callback, and not in an effect that
        // reacts to `scrolledPast`: an effect that chains setState is an extra
        // render on every scroll.
        if (!next) {
          setDismissed(false);
        }

        setScrolledPast(next);
      },
      { threshold: 0 },
    );

    observer.observe(dock);

    return () => observer.disconnect();
  }, [enabled]);

  const mini = enabled && scrolledPast && !dismissed;

  return (
    <div
      ref={dockRef}
      className={`member-video-dock${mini ? " member-video-dock--mini" : ""}`}
      data-mini={mini ? "true" : "false"}
      style={mini && reservedHeight > 0 ? { minHeight: reservedHeight } : undefined}
    >
      <div className="member-video-frame">
        {children}
        <div className="member-video-mini">
          <p className="member-video-mini__title">{title}</p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="member-video-mini__close"
            aria-label={closeLabel}
          >
            <X aria-hidden size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}
