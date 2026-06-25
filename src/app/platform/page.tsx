import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { productSurfaces } from "@/data/site";

export default function PlatformPage() {
  return (
    <PlatformShell
      eyebrow="Platform overview"
      title="A connected experience for learning and teaching."
      description="Explore the public surfaces that connect discovery, courses, educator profiles, and support."
    >
      <div className="grid gap-5 lg:grid-cols-3">
        {productSurfaces.map((surface) => (
          <Link
            key={surface.title}
            href={surface.href}
            className="rounded-[18px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)] transition-transform hover:-translate-y-1"
          >
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {surface.label}
            </p>
            <h3 className="display-title mt-3 text-3xl leading-none text-[var(--color-ink)]">
              {surface.title}
            </h3>
            <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
              {surface.summary}
            </p>
          </Link>
        ))}
      </div>
    </PlatformShell>
  );
}
