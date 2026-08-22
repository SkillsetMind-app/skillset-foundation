/**
 * The course sales page — blocks a teacher arranges, and the two templates they
 * arrange them in.
 *
 * WHY THIS IS DATA AND NOT HTML. There is no HTML sanitiser anywhere in this
 * repository — no DOMPurify, nothing — and `toPlainProse` is a markdown
 * normaliser for the AI chat panels, not a security boundary. A sales page that
 * accepted rich text would therefore be a stored-XSS surface on a page served to
 * anonymous visitors. So the teacher fills in fields, and React renders them as
 * text. `dangerouslySetInnerHTML` must never appear in the renderer.
 *
 * WHY A SEPARATE TABLE AND NOT A COLUMN ON `courses`. Two reasons, both measured
 * rather than guessed:
 *
 * 1. `subscribeToPublishedTeacherCourses` does `select('*')` with LIMIT 200 on
 *    every marketplace visit. A fat column there multiplies the payload by 200
 *    for every visitor, including the ones who never open a sales page.
 *
 * 2. `update_teacher_course_builder` is FULL-REPLACE: a field missing from the
 *    payload is overwritten with a computed default. It has three callers, one
 *    of them an autosave. Landing blocks living in that payload would be wiped
 *    the first time any caller forgot to resend them — silently, and in the
 *    background.
 *
 * A separate row keyed by course id costs one extra read on the page that
 * actually needs it, and removes both problems entirely.
 *
 * EVERY LIMIT BELOW IS A REAL DEFENCE, not a style choice. The row is
 * world-readable for any course in `published` or `in_review`, so the caps are
 * what stand between a teacher and using our database as free storage.
 */

import { getSafeExternalUrl, getSafeMediaUrl } from "@/domain/external-url";

/** Ships with two, which is what a teacher needs to feel a choice was made. */
export const courseLandingTemplates = ["classic", "bold"] as const;
export type CourseLandingTemplate = (typeof courseLandingTemplates)[number];

export const courseLandingTemplateLabels: Record<CourseLandingTemplate, string> = {
  classic: "Classic",
  bold: "Bold",
};

export type CourseLandingBlock =
  | { kind: "hero"; heading: string; subheading: string; imageUrl: string | null }
  | { kind: "about"; heading: string; body: string; imageUrl: string | null }
  | { kind: "method"; heading: string; body: string }
  | { kind: "steps"; heading: string; steps: ReadonlyArray<{ title: string; body: string }> }
  | { kind: "testimonials"; heading: string; quotes: ReadonlyArray<{ quote: string; author: string }> }
  | { kind: "faq"; heading: string; items: ReadonlyArray<{ question: string; answer: string }> }
  | { kind: "cta"; heading: string; body: string; buttonLabel: string };

export type CourseLandingBlockKind = CourseLandingBlock["kind"];

export const courseLandingBlockKinds: ReadonlyArray<CourseLandingBlockKind> = [
  "hero",
  "about",
  "method",
  "steps",
  "testimonials",
  "faq",
  "cta",
];

export const courseLandingBlockLabels: Record<CourseLandingBlockKind, string> = {
  hero: "Headline",
  about: "About you",
  method: "Your method",
  steps: "Step by step",
  testimonials: "What people say",
  faq: "Questions",
  cta: "Call to action",
};

/**
 * Caps. Sized so a full page of every block type stays comfortably under a few
 * kilobytes — the row is fetched on a public page and stored per course.
 */
export const LANDING_LIMITS = {
  /** Hard ceiling regardless of plan; the plan quota may be lower. */
  maxBlocks: 20,
  maxHeading: 120,
  maxBody: 1_200,
  maxShortText: 200,
  maxItemsPerList: 12,
  /** Total serialized size. Belt to the per-field braces. */
  maxSerializedBytes: 16_000,
} as const;

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function heading(value: unknown): string {
  return text(value, LANDING_LIMITS.maxHeading);
}

function body(value: unknown): string {
  return text(value, LANDING_LIMITS.maxBody);
}

function short(value: unknown): string {
  return text(value, LANDING_LIMITS.maxShortText);
}

/**
 * Images go through the repo's existing media allowlist rather than a fresh
 * check. `getSafeMediaUrl` already refuses anything that is not same-origin or
 * an https URL on an allowlisted host, which is what stops a block from
 * embedding a tracking pixel or an off-platform asset that later turns into
 * something else.
 */
function image(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return getSafeMediaUrl(value.trim()) ?? null;
}

function list<T>(
  value: unknown,
  map: (entry: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value.slice(0, LANDING_LIMITS.maxItemsPerList)) {
    if (typeof entry !== "object" || entry === null) continue;
    const mapped = map(entry as Record<string, unknown>);
    if (mapped) out.push(mapped);
  }
  return out;
}

/**
 * Normalises one block, or returns null to drop it.
 *
 * Dropping silently — rather than throwing — matches how the rest of the repo
 * treats teacher input (see `normalizeLearningOutcomes`). A malformed block is
 * a bug in a client or an edited row, and the right outcome is a page that
 * renders without it, not a page that refuses to render.
 */
function normalizeBlock(raw: unknown): CourseLandingBlock | null {
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;

  switch (input.kind) {
    case "hero": {
      const h = heading(input.heading);
      if (!h) return null;
      return {
        kind: "hero",
        heading: h,
        subheading: short(input.subheading),
        imageUrl: image(input.imageUrl),
      };
    }
    case "about": {
      const h = heading(input.heading);
      const b = body(input.body);
      if (!h && !b) return null;
      return { kind: "about", heading: h, body: b, imageUrl: image(input.imageUrl) };
    }
    case "method": {
      const h = heading(input.heading);
      const b = body(input.body);
      if (!h && !b) return null;
      return { kind: "method", heading: h, body: b };
    }
    case "steps": {
      const steps = list(input.steps, (entry) => {
        const title = short(entry.title);
        if (!title) return null;
        return { title, body: body(entry.body) };
      });
      if (steps.length === 0) return null;
      return { kind: "steps", heading: heading(input.heading), steps };
    }
    case "testimonials": {
      const quotes = list(input.quotes, (entry) => {
        const quote = body(entry.quote);
        if (!quote) return null;
        return { quote, author: short(entry.author) };
      });
      if (quotes.length === 0) return null;
      return { kind: "testimonials", heading: heading(input.heading), quotes };
    }
    case "faq": {
      const items = list(input.items, (entry) => {
        const question = short(entry.question);
        if (!question) return null;
        return { question, answer: body(entry.answer) };
      });
      if (items.length === 0) return null;
      return { kind: "faq", heading: heading(input.heading), items };
    }
    case "cta": {
      const h = heading(input.heading);
      if (!h) return null;
      return {
        kind: "cta",
        heading: h,
        body: body(input.body),
        // The CTA never carries its own URL. It always drives the course's real
        // checkout, so a teacher cannot point their "Enrol" button at an
        // off-platform payment link and take the sale outside the contract.
        buttonLabel: short(input.buttonLabel) || "Enrol now",
      };
    }
    default:
      return null;
  }
}

export function normalizeCourseLandingBlocks(
  raw: unknown,
  maxBlocks: number = LANDING_LIMITS.maxBlocks,
): CourseLandingBlock[] {
  if (!Array.isArray(raw)) return [];

  const ceiling = Math.max(0, Math.min(maxBlocks, LANDING_LIMITS.maxBlocks));
  const blocks: CourseLandingBlock[] = [];

  for (const entry of raw) {
    if (blocks.length >= ceiling) break;
    const block = normalizeBlock(entry);
    if (block) blocks.push(block);
  }

  // Size belt. Per-field caps bound each block, but a page of twenty full ones
  // can still add up; trimming from the end keeps whatever the teacher put
  // first, which is the part visitors actually see.
  while (
    blocks.length > 0 &&
    JSON.stringify(blocks).length > LANDING_LIMITS.maxSerializedBytes
  ) {
    blocks.pop();
  }

  return blocks;
}

export function normalizeCourseLandingTemplate(raw: unknown): CourseLandingTemplate {
  return courseLandingTemplates.includes(raw as CourseLandingTemplate)
    ? (raw as CourseLandingTemplate)
    : "classic";
}

/**
 * A starter page, so a teacher opening the editor sees a shape to edit instead
 * of a blank screen. Every heading is a prompt about their own work — nothing
 * here claims anything on their behalf.
 */
export function starterLandingBlocks(courseTitle: string): CourseLandingBlock[] {
  return [
    {
      kind: "hero",
      heading: courseTitle.slice(0, LANDING_LIMITS.maxHeading) || "Your course",
      subheading: "One line on who this is for.",
      imageUrl: null,
    },
    { kind: "about", heading: "About me", body: "", imageUrl: null },
    { kind: "method", heading: "How I teach this", body: "" },
    {
      kind: "steps",
      heading: "What we do, step by step",
      steps: [{ title: "Step one", body: "" }],
    },
    { kind: "cta", heading: "Ready to start?", body: "", buttonLabel: "Enrol now" },
  ];
}

/**
 * Words that are protected professional titles in the United States. The course
 * category vocabulary already bans them (see the note at the top of
 * teacher-course.ts); free-text blocks inherit exactly the same exposure, and
 * until now nothing checked for them.
 *
 * This WARNS, it does not block. The teacher may have a legitimate licence, and
 * a platform that silently refused their own credential would be both wrong and
 * infuriating. Deciding for them is not our call; failing to mention it is.
 */
const PROTECTED_TITLE_PATTERN =
  /\b(therapist|therapy|psychologist|psychology|psychotherap\w*|counselor|counsellor|clinical|clinician|diagnos\w+|treat(?:s|ment)?|cure[sd]?|heal(?:s|ing)?\s+(?:anxiety|depression|trauma))\b/gi;

export function protectedTitleWarnings(
  blocks: ReadonlyArray<CourseLandingBlock>,
): ReadonlyArray<string> {
  const found = new Set<string>();

  const scan = (value: string) => {
    for (const match of value.matchAll(PROTECTED_TITLE_PATTERN)) {
      found.add(match[0].toLowerCase());
    }
  };

  for (const block of blocks) {
    switch (block.kind) {
      case "hero":
        scan(block.heading);
        scan(block.subheading);
        break;
      case "about":
      case "method":
        scan(block.heading);
        scan(block.body);
        break;
      case "steps":
        scan(block.heading);
        block.steps.forEach((s) => {
          scan(s.title);
          scan(s.body);
        });
        break;
      case "testimonials":
        scan(block.heading);
        block.quotes.forEach((q) => scan(q.quote));
        break;
      case "faq":
        scan(block.heading);
        block.items.forEach((i) => {
          scan(i.question);
          scan(i.answer);
        });
        break;
      case "cta":
        scan(block.heading);
        scan(block.body);
        break;
    }
  }

  return [...found].sort();
}

/**
 * Re-exported so the renderer can link out of a block without importing the
 * sanitiser separately, and so there is one obvious answer to "how do I make a
 * link safe here".
 */
export { getSafeExternalUrl };
