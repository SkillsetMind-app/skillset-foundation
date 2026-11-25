"use client";

import { useEffect, useRef, useState } from "react";

// The entrance is decoration, never a condition for seeing the section. Without
// JavaScript, before hydration, in a browser without IntersectionObserver or
// with reduced motion, the section stays visible. Only after mounting, and only
// if it is still below the screen (where nobody sees it vanish), it is "armed":
// it starts transparent and comes in when its top passes 90% of the screen
// height. The threshold used to be 15% of the section, and a ~2900px band on a
// phone left ~430px of blank page before it appeared.
export function useRevealOnView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [armed, setArmed] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;

    if (!node || typeof window.IntersectionObserver === "undefined") {
      return;
    }

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    // Already on screen, or above it: it stays as it is, with no flash.
    if (node.getBoundingClientRect().top < window.innerHeight) {
      return;
    }

    setArmed(true);
    const observer = new window.IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0 },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return { ref, armed, revealed };
}
