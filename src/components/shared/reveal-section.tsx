"use client";

import type { HTMLAttributes } from "react";

import { useRevealOnView } from "@/lib/ui/use-reveal-on-view";

type RevealSectionProps = HTMLAttributes<HTMLDivElement>;

// One soft entry per section, all at once: the old per-card stagger made a
// grid trickle in over half a second and read as the page still loading.
export function RevealSection({
  children,
  className = "",
  ...props
}: RevealSectionProps) {
  const { ref, revealed } = useRevealOnView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={[
        "reveal-on-view",
        revealed ? "reveal-on-view--in" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
