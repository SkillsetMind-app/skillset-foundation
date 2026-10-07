# Skillset Design System

> Premium international online education marketplace. White-first, navy-dominant, red-accented. Built to feel closer to Apple / Linear / Notion than a cheap LMS template.

---

## What Skillset is

Skillset is a course marketplace + learning community that connects independent experts and creators with serious professional learners. The product spans four surfaces, each with its own UX needs but a single shared visual language:

| Surface | Route(s) | Role |
| --- | --- | --- |
| **Public marketplace** | `/`, `/courses`, `/instructors`, `/about`, `/for-creators`, `/pricing` | Discovery, conversion, brand expression |
| **Student portal** | `/learn`, `/learn/community`, `/learn/events`, `/learn/credentials` | Enrolled course workspace, community, progress, certificates |
| **Creator/Teacher Studio** | `/teach`, `/teach/builder`, `/teach/media` | Course building, media library, submission-for-review, payouts |
| **Ops / Trust** | `/ops`, `/support` | Review queue, moderation, support tickets, payment ops |

The frame around all of them is the **Platform shell**: sticky sidebar nav with section groups (Discover / Learn / Teach / Account / Ops), a workspace header with search + actions + avatar, and a polished card stack for content.

## Brand pillars
- **Trust.** Reads like an institution — navy dominates, decorative serif is used sparingly for display.
- **Clarity.** Generous whitespace, calm hierarchy, no cluttered dashboards.
- **Premium.** Subtle shadows, fine 12% navy dividers, structured layouts.
- **International credibility.** Faculty + program-first; no regional positioning copy.
- **Course-first, creator-friendly.** Both sides of the marketplace are equal citizens.

## Sources / provenance
The design language is reverse-engineered from these primary sources (read-only):

- **Codebase:** `SkillsetUSA/` — Next.js 16 + React 19 + Tailwind v4 application (`skillset-foundation`). Token source: `SkillsetUSA/src/app/globals.css`. Brand metadata: `SkillsetUSA/src/data/brand.ts`. Logo: `SkillsetUSA/public/brand/skillset-logo.png`.
- **GitHub mirror:** `opatricksimon/skillset-foundation` (private, default branch `main`). Same content as the local mount.
- **Notes:** `SkillsetUSA/docs/skillset-alpha-execution-plan.md`, `vision/`, `marketplace-payments-plan.md` (read for product context only, not visuals).

Nothing visual was invented — colors, type pairing, button system, card chrome, sidebar nav style, and copywriting tone all come directly from the existing codebase.

---

## Index of this design system

| File / folder | Contents |
| --- | --- |
| `README.md` | This file — context, content fundamentals, visual foundations, iconography |
| `colors_and_type.css` | Authoritative CSS variables for color, type, spacing, radii, shadows, motion |
| `SKILL.md` | Agent-skills compatible front-matter for downstream tools |
| `assets/` | Logos, favicon, icon notes |
| `preview/` | Per-token preview cards (rendered in the Design System tab) |
| `ui_kits/marketing/` | Public marketplace UI kit (homepage, course catalog, course detail) |
| `ui_kits/platform/` | Student + Teacher + Ops shell UI kit (sidebar, headers, dashboards, review queue) |

---

## CONTENT FUNDAMENTALS

### Voice
Skillset reads like a serious institution that is also a working product. Sentences are short, declarative, and confident. The brand is talking to a professional adult who is investing in their career — not to a casual hobbyist.

- **Second person ("you") in marketing copy**, e.g. "Sign in and Skillset will send you to the right workspace for this path."
- **Third person ("Skillset") for product behavior**, e.g. "Skillset review controls marketplace visibility."
- **Never first person ("we", "our").** The product is named, not personified.
- **No exclamation points.** No "Welcome!", no "Let's get started!".
- **No marketing fluff.** No "revolutionize", "unlock", "supercharge", "delight".

### Tone in practice (real examples from the codebase)
- Hero: *"Learn From The Best. Become The Best."* — title case on hero only; everything else sentence case.
- Hero sub: *"A premium learning platform for expert-led courses, focused student progress, and communities built around professional growth."*
- CTA: *"Explore courses"*, *"Start teaching"*, *"View program"* — verbs, no punctuation.
- Empty state: *"Your learning dashboard is ready."* — present-tense, calm.
- Trust copy: *"Marketplace visibility remains controlled by Skillset review so the platform does not turn into a noisy upload directory."* — slightly editorial, plain-spoken, anti-spam.
- Error: *"We could not create this course. Please try again or contact Skillset support."* — owns the failure, names the brand, no apology theater.

### Casing
- **Sentence case for everything**, including buttons, nav, card titles, headings — except the hero h1 which uses Title Case for the headline halves and on uppercase eyebrows.
- **UPPERCASE eyebrows** with wide tracking (0.18–0.22em) for category labels above headings, e.g. `PROGRAMS`, `FOR CREATORS`, `MY LEARNING`. Always set in accent red or brand navy.

### Punctuation
- Periods at the end of paragraph sentences and on full-sentence card descriptions.
- **No** trailing period on button labels, eyebrows, nav items, or single-clause card titles.
- Em dashes are fine; avoid semicolons in product copy.
- Numerals for everything in product (`8 min`, `12% complete`, `3 modules / 14 lessons`).

### Names of things
- "Course", "Program", "Pathway" — used interchangeably for paid offerings.
- "Educator", "Creator", "Teacher" — used interchangeably for sellers. "Educator" leans formal, "Creator" leans modern, "Teacher" appears in feature names (Teacher Studio).
- "Learner" or "Student" for buyers.
- Surfaces are named: **Classroom**, **Teacher Studio**, **Course Builder**, **Media Library**, **Operations**.

### Emoji & decorative characters
- **No emoji.** Anywhere. The product never uses 🎓 / ✨ / 🚀 / 📚 / etc.
- **No unicode pictographs as icons.** Use real icons (Lucide) or short letter ciphers (see Iconography).
- The em-dash, slash and bullet are fine; the ✓ / ✦ / → glyphs are not used in the existing UI.

---

## VISUAL FOUNDATIONS

### Color
- **White is the base** for every surface, including dashboards. Page tints are a near-white blue (`#f5f9ff` / `#ebf3fb`) — almost imperceptible, used to create slight separation between cards and page.
- **Navy `#1a365d`** is the brand color and dominates as button fill, headline color, active-nav fill, and on the hero panel. A darker `#0f2744` is the hover/active for solid buttons.
- **Red `#b22234`** (US-flag red, derived from the logo's flag flourish) is *only* used as a restrained accent — uppercase eyebrows, small "Educator/Learner" role chips, error states, the "Skillset review note" inset, the 1-pixel bottom rule on the hero. Never as a primary button fill in dark contexts; on light contexts there is a `button-solid-light` variant that uses red for very specific calls-to-action on dark panels.
- **Ink hierarchy:** `--color-ink #163252` (default body), `--color-ink-soft #4d6785` (meta / paragraph body), `--color-ink-muted #7a8fae` (placeholder / disabled).
- **Dividers** are always navy at 12% alpha (`--color-line`), never gray. This is what gives the system its quiet "blueprint" feel.

### Typography
- **Display:** Cormorant Garamond (weights 500/600/700). Used for hero headlines, h1–h3, card titles, big stat numbers. Never used below 24px.
- **Sans (UI + body):** Manrope (400/500/600/700/800). Everything else — body, buttons, nav, labels, eyebrows.
- **Pairing rule:** every screen has at most *one* display headline; sub-sections use Manrope bold. This is the signal that Skillset is institutional, not a marketing site shouting at you.
- **Eyebrows** are Manrope `font-weight: 600`, `letter-spacing: 0.22em`, uppercase, 12px, in accent red or brand navy.
- **Body** is Manrope 14px / line-height 1.75 in `--color-ink-soft`. Long-form prose uses `leading-7` (1.75) — generous.

### Backgrounds
- The page-shell sits on a layered background: a soft radial in the top-left (`rgba(44,82,130,0.07)`) over a near-imperceptible vertical gradient from `#ffffff` → `#fbfdff` → `#f5f8fc`. Calm, not flashy. No mesh gradients, no full-bleed photography on dashboards.
- The hero panel uses a **navy gradient** (`#07172a → #102944 → #1a365d`) overlaid with two **soft radial highlights** (white at 18%/28%, red at 86%/64%, both ~0.45 alpha) — these are the only places where light radials are used. Always finished with a 1-pixel solid red bottom rule.
- Course cards use full-bleed photography (4:3) overlaid with a navy gradient `from-[rgba(15,39,68,0.84)] via-transparent to-transparent` so chips remain legible against any image.
- **No** repeating patterns, no hand-drawn illustrations, no grain, no noise overlays.

### Cards
- **Default card:** white background, 1px navy-12% border, `--shadow-soft`, radius 12px (`--radius-lg`, `rounded-lg`) — hero/course cards, dashboard panels and feature panels alike. Small nested boxes inside a card use 8px (`rounded-md`).
- **`surface-card`:** white at 92% alpha + backdrop blur (used over the page-shell gradient).
- **Active sidebar nav** is the only place a card-like element becomes solid navy with a heavier `0 10px 22px rgba(26,54,93,0.16)` shadow.

### Buttons
Four variants — all radius 8px (`--radius-md`), weight 600, line-height 1, gap 8px between icon and label.

| Variant | Use on | Fill | Border | Text | Effects |
| --- | --- | --- | --- | --- | --- |
| `button-solid` | Light surfaces, primary action | navy `#1a365d` | navy border | white | inset bottom 2px red 35% + soft navy drop |
| `button-outline` | Light surfaces, secondary | white 92% | navy 18% | navy | hover → fill soft-blue, border darkens |
| `button-solid-light` | **Dark surfaces** only, primary | accent red | red 92% | white | strong drop shadow |
| `button-outline-light` | Dark surfaces, secondary | white 10% | white 42% | white | hover lifts |

Hover for all: `transform: translateY(-1px)` + 180ms ease. Active: `translateY(0)`. Focus: 2px navy-28% outline, 3px offset.

### Inputs
- Radius 8px (`--radius-md`) — inputs, selects and textareas match the buttons. Border `--color-line`, white fill (or `--color-surface-soft` on disabled), 16px padding, 14px Manrope regular. Focus border becomes `--color-primary-light` (`#2c5282`). No focus ring shadow — just a border color change. Disabled inputs keep the soft-blue fill and `ink-soft` text.

### Chips & badges
- **Status chip:** white 94% bg, white 70% border, navy or red text, **rounded-full**, 11px / weight 600 / tracking 0.22em UPPERCASE — placed on top of course imagery (`accent-chip`).
- **Role chip:** navy text on white **rounded-full** pill with red 18% border, 10px / weight 700 / tracking 0.12em.
- **"Beta" badge:** white bg, red 18% border, red text, 10px uppercase, radius 6px (`--radius-chip`, `rounded-chip`) — it was never a pill.
- **Verified badge:** the label is a chip (6px, `rounded-chip`); the seal is a 16px square with a 4px corner (`--radius-sm`), never a circle.
- **Section count pill:** soft-blue bg, navy text, 12px / weight 600 / tracking 0.14em uppercase.

### Borders & dividers
- Card borders are always 1px in `rgba(26,54,93,0.12)`. Never gray.
- The `.fine-rule` helper applies that color to a `<hr>` or to `border-color`.
- Sidebar sub-sections are separated by a 1px top border + 16px top padding — not by background color.

### Shadows
Two-tier system; nothing colored.
- `--shadow-soft` `0 12px 28px rgba(26,54,93,0.06)` — default for cards.
- `--shadow-strong` `0 18px 44px rgba(15,39,68,0.14)` — used on dropdown panels, the hero CTA blue band, and the floating dropdown over the hero.
- Buttons carry their own inset/drop shadows (see Buttons).
- Avatars carry a small `0 8px 18px rgba(26,54,93,0.14)` ring.

### Radii (subtle, one per role)
Corners are slightly rounded — founder decision of 2026-10-06, which reverses the square corners of #447 (2026-10-01). The tokens live in the `@theme` block of `src/app/globals.css`, so Tailwind's `rounded-*` classes read them; never write a pixel radius by hand.

| Token | Value | Class | Use |
| --- | --- | --- | --- |
| `--radius-sm` | 4px | `rounded-sm` | verified seal, tiny marks, a tab inside a segmented control |
| `--radius-chip` | 6px | `rounded-chip` | chips and badges |
| `--radius-md` | 8px | `rounded-md` | buttons, inputs, selects, textareas, icon buttons, small tiles |
| `--radius-lg` | 12px | `rounded-lg` | cards, panels, dropdowns |
| `--radius-xl` | 16px | `rounded-xl` | dialogs and sheets (sheets round only the top) |

Nothing goes above 16px: `--radius-2xl`, `--radius-3xl` and `--radius-4xl` are capped at 16px. **Fully round (`rounded-full`) only for avatars, status dots, spinners, toggles, progress bars, round icon glyphs, and the chips/badges that were already pills (they stay `rounded-full`). Text buttons are never pills: 8px (`rounded-md`).** Full-bleed bands (cookie banner, footer, header) stay square — they touch the screen edge.

### Spacing & layout
- **4px base spacing scale** (`--space-1` → `--space-12`). The most common values in the code are 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **Max container width 1280px** (`max-w-7xl`) with `px-5` on mobile / `px-8` on desktop.
- **Platform grid** is a 252px sticky sidebar + 1fr main column, gap 24px. Below 920px the sidebar collapses to a top row.
- **Vertical rhythm:** sections use `py-12` to `py-24`. Cards use `p-5` (5×4) or `p-6` (6×4). Dashboard panels use `p-3` outer + nested `p-3` inner.

### Motion
- Transitions are **always 180ms** ease for state changes — `transform`, `background-color`, `border-color`, `box-shadow`, `color`. Defined as `--duration-base`.
- Hover lift: `translateY(-1px)`. Active: `translateY(0)`.
- Page transitions: none. Sticky elements, no parallax.
- `prefers-reduced-motion: reduce` is honoured globally (`transition-duration: 0.01ms !important`).

### Hover / press states
- **Buttons:** small lift, darker fill (for solids) or slightly darker border + soft-blue fill (for outlines). Never an opacity change.
- **Links inside cards:** `hover:-translate-y-1` for the whole card (instructor cards, course cards). Color does not change.
- **Sidebar nav:** non-active items hover into `--color-surface-soft` background + `--color-ink` text. Active item is navy fill + white text + soft drop shadow — no hover change needed.
- **Sign-out / destructive:** red text on a `rgba(178,34,52,0.06)` hover background.
- **Press states:** no scale-down. The `translateY(0)` reset is the only press feedback.

### Use of transparency & blur
- The sticky site header is `rgba(255,255,255,0.94)` + `backdrop-blur-xl`.
- The `.surface-card` helper is `rgba(255,255,255,0.92)` + `backdrop-filter: blur(18px)` — used for cards that sit over the page-shell gradient.
- Dropdown panels are solid white with shadow — no blur.
- The dark hero panel uses `white/10` and `white/14` for nested pills; `white/20` for borders.

### Imagery
- Faculty + course imagery is **warm-toned color photography** at 4:3, always overlaid with the navy gradient bottom-to-top so chips and titles stay legible. The codebase pulls from Pinterest CDN URLs in the demo data.
- No b&w. No grain. No duotones.
- No illustrations of people; no hand-drawn glyphs.
- Aspect ratios are strict: 4:3 for cards, 16:10 for enrolled-course thumbnails (220px wide).

### Layout rules (fixed elements)
- **Header** is sticky top with the white-94% blur background and a 1px navy-12% bottom rule.
- **Sidebar** is `position: sticky; top: 1rem` inside the platform grid.
- **Footer** is *not* sticky — it lives inside a card at the bottom of the page.
- **Dropdowns** anchor right (`right-0 mt-2`) and have a 12px radius (`rounded-lg`).

### What to AVOID
- Purple, magenta, teal, mint, peach.
- Bluish-purple gradients, sunset gradients, mesh gradients.
- Glassmorphism beyond the two `backdrop-blur` cases above.
- Pill-shaped buttons.
- Emoji and unicode pictographs.
- Cards with a colored left-border accent.
- Stat blocks built from emoji + huge number + cute label.
- Drop shadows that use any color other than navy at low alpha.
- AI / startup tropes: "Unlock", "AI-powered", "Supercharge".

---

## ICONOGRAPHY

### Source of truth
The product uses **`lucide-react` (v0.553.0)** — confirmed in `SkillsetUSA/package.json`. Lucide gives Skillset a single, consistent line-icon family at 1.5px stroke weight that pairs naturally with the institutional navy aesthetic.

### How icons are used in the existing UI
Surprisingly little. The current codebase leans on a **letter-cipher** convention instead of icons for sidebar nav:

```ts
{ href: "/learn",            label: "Classroom",     shortLabel: "C"  }
{ href: "/learn/community",  label: "Community",     shortLabel: "Co" }
{ href: "/learn/credentials",label: "Credentials",   shortLabel: "Cr" }
{ href: "/teach",            label: "Teacher Studio",shortLabel: "T"  }
{ href: "/teach/builder",    label: "Course Builder",shortLabel: "B"  }
```

These short labels (1–2 letters of the destination name) render inside a 28×28 rounded square — white on navy when active, navy on white when idle. **This is a signature device of Skillset.** Use it before reaching for a Lucide icon for sidebar items.

Lucide icons appear in:
- Auth flows (Google mark in `google-mark.tsx` — inline SVG, not Lucide).
- Inline marks inside buttons (rare).
- Future moderation queues + media library — slots are reserved but most are still text-only.

### When to use what
| Need | Use |
| --- | --- |
| Sidebar nav slot | **Letter cipher** (1–2 caps in a 28×28 rounded square) |
| Inline button mark | Lucide line icon, 16×16, 1.5px stroke, navy or white |
| Status decoration | **Avoid icons** — use a text chip with eyebrow tracking instead |
| Brand / logo | `assets/skillset-logo.png` — wordmark with navy "S" globe + USA flag flourish |
| Favicon / app tile | `assets/skillset-favicon.png` |

### Loading Lucide
```html
<!-- CDN, no install -->
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
<script>lucide.createIcons();</script>
```
…or in React with `lucide-react` as the codebase does.

### What to NEVER do for icons
- Don't hand-draw SVG icons. Use Lucide or copy from `lucide.dev`.
- Don't use Material/Bootstrap/FontAwesome — they break the line weight + corner style.
- Don't use emoji. Don't use unicode arrows (`→`, `›`) inside buttons — use real Lucide `arrow-right` or text only.
- Don't tint icons in red unless they're inside an error state.

### Logo usage
- **Full lockup** (`assets/skillset-logo.png`): wordmark + USA flag flourish — for marketing surfaces, the public site header (rendered at 62×19 in nav, 92×28 compact, 132×40 large), and printed materials.
- **Favicon** (`assets/skillset-favicon.png`): browser tab + app icon only.
- The wordmark must always sit on white or the navy `--color-primary` panel. No tinted backgrounds.
- Minimum size: 62px wide in nav contexts.

---

## Font substitution disclosure

Both fonts in the codebase are loaded via `next/font/google` (i.e. they are Google Fonts at runtime, not licensed self-hosted files):
- **Manrope** — Google Fonts, no substitution needed.
- **Cormorant Garamond** — Google Fonts, no substitution needed.

No local `.ttf` / `.woff2` files exist in the codebase, so this design system also loads them from Google Fonts (`@import` at the top of `colors_and_type.css`). **If you need offline use, download the families from `fonts.google.com/specimen/Manrope` and `fonts.google.com/specimen/Cormorant+Garamond` into a `fonts/` directory.**

---

## Surfaces, in one diagram

```
┌─ Public marketplace ──────────────────────────────────┐
│  /, /courses, /instructors, /about, /for-creators     │
│  Sticky white header • Navy hero • Course cards (4:3) │
│  Footer card with 4 columns + © line                  │
└────────────────────────────────────────────────────────┘
┌─ Platform shell (Student + Teacher + Ops) ───────────┐
│  Sidebar (252px, sticky, sectioned)                  │
│    └ Discover / Learn / Teach / Account / Ops        │
│  Header card (label + search + actions + avatar)     │
│  Title card (eyebrow + display title + lead)         │
│  Content stack of card panels                        │
└──────────────────────────────────────────────────────┘
```

---

_See `ui_kits/` for working recreations of each surface, and the Design System tab for preview cards of every token._
