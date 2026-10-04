export const brand = {
  name: "SkillsetMind",
  shortName: "SkillsetMind",
  title: "SkillsetMind | Coaching, Personal Development & Human Potential",
  description:
    "A vertical business and learning platform for coaching, personal development and human potential.",
  logoAlt: "SkillsetMind — two profiles forming a chalice",
  // Kept as a compatibility alias for metadata and legacy consumers.
  logoUrl: "/brand/logo-full-light-v2.png",
  faviconUrl: "/brand/favicon-solid.png",
  // Vector redraws of the v2 lockups (same symbol path and DejaVu Sans
  // outlines, transparent, no background rect). Navy on light, white on dark.
  // logoUrl and logoMark stay PNG: social cards and email clients do not
  // render SVG.
  logoFullLight: "/brand/logo-full-navy.svg",
  logoFullDark: "/brand/logo-full-white.svg",
  logoFullLightSize: { width: 1600, height: 320 },
  logoFullDarkSize: { width: 1600, height: 320 },
  logoMark: "/brand/logo-mark-navy.png",
  logoMarkLight: "/brand/logo-mark-navy.svg",
  logoMarkDark: "/brand/logo-mark-white.svg",
  logoMarkSize: { width: 512, height: 512 },
  faviconSize: { width: 512, height: 512 },
} as const;
