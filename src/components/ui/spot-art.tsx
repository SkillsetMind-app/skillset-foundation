import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The five studio scenes, in the banknote-engraving line work the brand uses in
 * the site background (public/brand/hero-engraving-*). The check and the milestone seal
 * live in ui/drawn-check.tsx. Inline SVG, no network: each scene weighs under 3 KB, which matters
 * for people who open the studio on a bad connection.
 *
 * Drawing rules (the test checks the ones that can be measured):
 * - navy stroke of 1.25 to 1.5px (`vector-effect` in the CSS keeps the px at
 *   any size);
 * - the engraving in ellipses and waves at 15–35% opacity;
 * - ONE brass element per scene; the rest, when it needs color, is light brass.
 *   The exception is the receipt (noSales): it lives in the revenue chart, and solid
 *   brass in a money chart is forbidden; only light brass goes there;
 * - token corners (rx 2 in the viewBox ~ sm radius on screen);
 * - no people, no drawn money, no numbers;
 * - `aria-hidden`: the text beside it already says everything.
 *
 * `tone="light"` is the version for a navy background (column of the create screen).
 */
export type SpotArtScene = "firstProduct" | "firstLesson" | "noStudents" | "noSales" | "published";

export const spotArtScenes: readonly SpotArtScene[] = [
  "firstProduct",
  "firstLesson",
  "noStudents",
  "noSales",
  "published",
];

export type SpotArtProps = {
  scene: SpotArtScene;
  tone?: "default" | "light";
  className?: string;
};

// The whole tone lives in 5 variables on the <svg>; the shapes only read the variables.
// In the dark theme, --color-primary and --color-surface already invert on their own.
const tones: Record<NonNullable<SpotArtProps["tone"]>, CSSProperties> = {
  default: {
    color: "var(--color-primary,#102a43)",
    "--art-paper": "var(--color-surface,#fff)",
    "--art-soft": "var(--color-accent-soft,#f4e8ce)",
    "--art-brass": "var(--color-accent,#c99a46)",
    "--art-on-brass": "#091d2f",
  } as CSSProperties,
  light: {
    color: "#fff",
    // Opaque paper, one step above the column's navy: the rosette passes
    // behind the document, not through it.
    "--art-paper": "#102a43",
    "--art-soft": "rgba(201,154,70,.24)",
    "--art-brass": "#c99a46",
    "--art-on-brass": "#091d2f",
  } as CSSProperties,
};

/** Guilloche rosette: `count` ellipses rotated around the same center. */
function rosette(cx: number, cy: number, rx: number, ry: number, count: number) {
  return (
    <g className="spot-art__engraving" opacity=".2" strokeWidth="1.25" transform={`translate(${cx} ${cy})`}>
      {Array.from({ length: count }, (_, index) => (
        <ellipse key={index} rx={rx} ry={ry} transform={`rotate(${Math.round((180 / count) * index)})`} />
      ))}
    </g>
  );
}

/** Engraving waves: one line per `y`, each with `segments` crests. */
function waves(x: number, ys: number[], segments: number, opacity = ".3") {
  const d = ys.map((y) => `M${x} ${y}q3-3 6 0${"t6 0".repeat(segments - 1)}`).join("");
  return <path className="spot-art__engraving" d={d} opacity={opacity} strokeWidth="1.25" />;
}

const scenes: Record<SpotArtScene, ReactNode> = {
  // Engraved document with the "+" seal in brass.
  firstProduct: (
    <>
      {rosette(80, 58, 46, 20, 9)}
      <rect x="54" y="14" width="52" height="72" rx="2" fill="var(--art-paper)" />
      {waves(62, [24, 29], 6)}
      <rect x="62" y="38" width="22" height="3" fill="currentColor" stroke="none" />
      <path d="M62 50h36M62 58h28M62 66h36" opacity=".35" />
      <rect className="spot-art__seal" x="92" y="72" width="22" height="22" rx="2" fill="var(--art-brass)" stroke="none" />
      <path d="M103 77v12M97 83h12" stroke="var(--art-on-brass)" strokeWidth="1.5" />
    </>
  ),
  // Three stacked cards; the front one with the "play" in brass.
  firstLesson: (
    <>
      {waves(28, [100, 105, 110], 17, ".25")}
      <rect x="62" y="16" width="64" height="44" rx="2" fill="var(--art-paper)" opacity=".7" />
      <rect x="50" y="26" width="66" height="46" rx="2" fill="var(--art-paper)" />
      <rect x="36" y="38" width="70" height="48" rx="2" fill="var(--art-paper)" />
      <rect className="spot-art__seal" x="60" y="49" width="22" height="20" rx="2" fill="var(--art-brass)" stroke="none" />
      <path d="M68 54v10l8-5z" fill="var(--art-on-brass)" stroke="none" />
      <path d="M44 78h30" opacity=".35" />
    </>
  ),
  // Grid of dashed seats; the first one in brass, with "+".
  noStudents: (
    <>
      {waves(26, [14, 19, 24], 18, ".25")}
      <g strokeDasharray="3 3" opacity=".55">
        <rect x="68" y="38" width="24" height="24" rx="2" />
        <rect x="102" y="38" width="24" height="24" rx="2" />
        <rect x="34" y="72" width="24" height="24" rx="2" />
        <rect x="68" y="72" width="24" height="24" rx="2" />
        <rect x="102" y="72" width="24" height="24" rx="2" />
      </g>
      <rect className="spot-art__seal" x="34" y="38" width="24" height="24" rx="2" fill="var(--art-soft)" stroke="var(--art-brass)" strokeWidth="1.5" />
      <path d="M46 44v12M40 50h12" />
    </>
  ),
  // Engraved receipt; the last line in light brass, navy outline. No
  // coin, no number and no solid brass (it goes in the revenue chart).
  noSales: (
    <>
      {rosette(80, 60, 40, 18, 9)}
      <path d="M56 12h48v84l-6-5-6 5-6-5-6 5-6-5-6 5-6-5-6 5z" fill="var(--art-paper)" />
      {waves(62, [22, 27], 6)}
      <path d="M62 40h22M62 49h22M62 58h22M62 67h22" opacity=".35" />
      <path d="M90 40h8M90 49h8M90 58h8M90 67h8" opacity=".35" />
      <rect className="spot-art__seal" x="62" y="75" width="36" height="7" rx="1.5" fill="var(--art-soft)" />
    </>
  ),
  // The document with the check seal stamped on it, the rosette and three diamonds.
  published: (
    <>
      {rosette(80, 58, 50, 22, 12)}
      <rect x="52" y="12" width="56" height="76" rx="2" fill="var(--art-paper)" />
      {waves(60, [22, 27], 7)}
      <rect x="60" y="36" width="24" height="3" fill="currentColor" stroke="none" />
      <path d="M60 47h40M60 55h32M60 63h40" opacity=".35" />
      <g className="spot-art__seal">
        <rect x="90" y="68" width="26" height="26" rx="2" fill="var(--art-brass)" stroke="none" />
        <path d="M96.5 81.5l4.5 4.5 9-9.5" stroke="var(--art-on-brass)" strokeWidth="1.5" />
      </g>
      <g className="spot-art__spark" fill="var(--art-soft)">
        <path d="M130 26l4 4-4 4-4-4z" />
        <path d="M34 78l3.5 3.5-3.5 3.5-3.5-3.5z" />
        <path d="M128 92l3 3-3 3-3-3z" />
      </g>
    </>
  ),
};

export function SpotArt({ scene, tone = "default", className }: SpotArtProps) {
  return (
    <svg
      viewBox="0 0 160 120"
      aria-hidden="true"
      focusable="false"
      data-scene={scene}
      className={cn("spot-art", className)}
      style={tones[tone]}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {scenes[scene]}
    </svg>
  );
}
