import { describe, expect, it } from "vitest";

import {
  LANDING_LIMITS,
  courseLandingTemplates,
  normalizeCourseLandingBlocks,
  normalizeCourseLandingTemplate,
  protectedTitleWarnings,
  starterLandingBlocks,
  type CourseLandingBlock,
} from "@/domain/course-landing";

describe("normalizeCourseLandingBlocks — accepts what a teacher builds", () => {
  it("keeps a full page of every block type", () => {
    const blocks = normalizeCourseLandingBlocks([
      { kind: "hero", heading: "Learn to draw", subheading: "For total beginners" },
      { kind: "about", heading: "About me", body: "Twelve years of practice." },
      { kind: "method", heading: "How I teach", body: "Short lessons, daily." },
      {
        kind: "steps",
        heading: "The path",
        steps: [{ title: "Warm up", body: "Ten minutes." }],
      },
      {
        kind: "testimonials",
        heading: "Students",
        quotes: [{ quote: "It worked.", author: "Ana" }],
      },
      { kind: "faq", heading: "Questions", items: [{ question: "How long?", answer: "6 weeks." }] },
      { kind: "cta", heading: "Start today", body: "", buttonLabel: "Join" },
    ]);

    expect(blocks).toHaveLength(7);
    expect(blocks.map((b) => b.kind)).toEqual([
      "hero",
      "about",
      "method",
      "steps",
      "testimonials",
      "faq",
      "cta",
    ]);
  });

  it("gives the CTA a default label rather than an empty button", () => {
    const [cta] = normalizeCourseLandingBlocks([
      { kind: "cta", heading: "Start", buttonLabel: "   " },
    ]);
    expect(cta).toMatchObject({ kind: "cta", buttonLabel: "Enrol now" });
  });
});

describe("normalizeCourseLandingBlocks — refuses what it should", () => {
  it("drops an unknown block kind instead of rendering it", () => {
    expect(normalizeCourseLandingBlocks([{ kind: "iframe", src: "evil" }])).toEqual([]);
  });

  it("drops a block with no content at all", () => {
    expect(normalizeCourseLandingBlocks([{ kind: "hero", heading: "  " }])).toEqual([]);
    expect(normalizeCourseLandingBlocks([{ kind: "steps", steps: [] }])).toEqual([]);
  });

  it("returns an empty page for anything that is not an array", () => {
    expect(normalizeCourseLandingBlocks(null)).toEqual([]);
    expect(normalizeCourseLandingBlocks("hero")).toEqual([]);
    expect(normalizeCourseLandingBlocks({ kind: "hero" })).toEqual([]);
  });

  // The row is world-readable for any course in `published` or `in_review`, so
  // the caps are what stand between a teacher and free storage.
  it("caps the number of blocks", () => {
    const many = Array.from({ length: 60 }, () => ({
      kind: "method",
      heading: "H",
      body: "B",
    }));
    expect(normalizeCourseLandingBlocks(many)).toHaveLength(LANDING_LIMITS.maxBlocks);
  });

  it("honours a plan quota lower than the hard cap", () => {
    const many = Array.from({ length: 30 }, () => ({
      kind: "method",
      heading: "H",
      body: "B",
    }));
    expect(normalizeCourseLandingBlocks(many, 4)).toHaveLength(4);
  });

  it("never lets a plan quota exceed the hard cap", () => {
    const many = Array.from({ length: 200 }, () => ({
      kind: "method",
      heading: "H",
      body: "B",
    }));
    expect(normalizeCourseLandingBlocks(many, 10_000)).toHaveLength(
      LANDING_LIMITS.maxBlocks,
    );
  });

  it("truncates an overlong field instead of storing it", () => {
    const [block] = normalizeCourseLandingBlocks([
      { kind: "method", heading: "x".repeat(5_000), body: "y".repeat(50_000) },
    ]);
    if (block.kind !== "method") throw new Error("expected a method block");
    expect(block.heading).toHaveLength(LANDING_LIMITS.maxHeading);
    expect(block.body).toHaveLength(LANDING_LIMITS.maxBody);
  });

  it("caps the items inside a list block", () => {
    const [block] = normalizeCourseLandingBlocks([
      {
        kind: "faq",
        items: Array.from({ length: 100 }, (_, i) => ({
          question: `Q${i}`,
          answer: "A",
        })),
      },
    ]);
    if (block.kind !== "faq") throw new Error("expected an faq block");
    expect(block.items).toHaveLength(LANDING_LIMITS.maxItemsPerList);
  });

  it("keeps the whole page under the serialized size belt", () => {
    const fat = Array.from({ length: LANDING_LIMITS.maxBlocks }, () => ({
      kind: "method",
      heading: "h".repeat(LANDING_LIMITS.maxHeading),
      body: "b".repeat(LANDING_LIMITS.maxBody),
    }));
    const blocks = normalizeCourseLandingBlocks(fat);
    expect(JSON.stringify(blocks).length).toBeLessThanOrEqual(
      LANDING_LIMITS.maxSerializedBytes,
    );
    // And it trimmed from the end, keeping what the teacher put first.
    expect(blocks.length).toBeLessThan(LANDING_LIMITS.maxBlocks);
  });
});

describe("normalizeCourseLandingBlocks — images go through the media allowlist", () => {
  // There is no HTML sanitiser in this repo, so an image URL is one of the few
  // places teacher input reaches an attribute. It reuses getSafeMediaUrl rather
  // than inventing a second check that could disagree with the first.
  it("refuses a javascript: URL", () => {
    const [block] = normalizeCourseLandingBlocks([
      { kind: "hero", heading: "H", imageUrl: "javascript:alert(1)" },
    ]);
    if (block.kind !== "hero") throw new Error("expected a hero block");
    expect(block.imageUrl).toBeNull();
  });

  it("refuses a data: URL", () => {
    const [block] = normalizeCourseLandingBlocks([
      { kind: "hero", heading: "H", imageUrl: "data:text/html;base64,PHN2Zz4=" },
    ]);
    if (block.kind !== "hero") throw new Error("expected a hero block");
    expect(block.imageUrl).toBeNull();
  });

  it("refuses an arbitrary http host", () => {
    const [block] = normalizeCourseLandingBlocks([
      { kind: "hero", heading: "H", imageUrl: "http://tracker.example/pixel.gif" },
    ]);
    if (block.kind !== "hero") throw new Error("expected a hero block");
    expect(block.imageUrl).toBeNull();
  });

  it("keeps a same-origin relative path", () => {
    const [block] = normalizeCourseLandingBlocks([
      { kind: "hero", heading: "H", imageUrl: "/uploads/cover.jpg" },
    ]);
    if (block.kind !== "hero") throw new Error("expected a hero block");
    expect(block.imageUrl).toBe("/uploads/cover.jpg");
  });

  // No block carries its own link target. The CTA always drives the course's
  // real checkout, so a teacher cannot route the sale off-platform.
  it("gives the CTA no url field to point anywhere", () => {
    const [block] = normalizeCourseLandingBlocks([
      { kind: "cta", heading: "Buy", url: "https://my-other-checkout.example" },
    ]);
    expect(block).not.toHaveProperty("url");
  });
});

describe("normalizeCourseLandingTemplate", () => {
  it("accepts the shipped templates", () => {
    for (const template of courseLandingTemplates) {
      expect(normalizeCourseLandingTemplate(template)).toBe(template);
    }
  });

  it("falls back rather than rendering an unknown template", () => {
    expect(normalizeCourseLandingTemplate("hacker")).toBe("classic");
    expect(normalizeCourseLandingTemplate(null)).toBe("classic");
    expect(normalizeCourseLandingTemplate(42)).toBe("classic");
  });
});

describe("starterLandingBlocks", () => {
  it("produces a page that survives its own normaliser", () => {
    const starter = starterLandingBlocks("Watercolour basics");
    expect(normalizeCourseLandingBlocks(starter)).toHaveLength(starter.length);
  });

  it("puts the course title in the headline", () => {
    const [hero] = starterLandingBlocks("Watercolour basics");
    expect(hero).toMatchObject({ kind: "hero", heading: "Watercolour basics" });
  });

  it("claims nothing on the teacher's behalf — every body starts empty", () => {
    const starter = starterLandingBlocks("Anything");
    const about = starter.find((b) => b.kind === "about");
    expect(about).toMatchObject({ body: "" });
  });
});

describe("protectedTitleWarnings — warns, never blocks", () => {
  // The course category vocabulary already bans these words because they are
  // protected professional titles in the US. Free-text blocks inherit exactly
  // the same exposure and, until now, nothing looked.
  it("spots a protected title in a body", () => {
    const blocks: CourseLandingBlock[] = [
      { kind: "method", heading: "My method", body: "I work as a therapist." },
    ];
    expect(protectedTitleWarnings(blocks)).toContain("therapist");
  });

  it("looks inside nested list blocks too", () => {
    const blocks: CourseLandingBlock[] = [
      {
        kind: "faq",
        heading: "Questions",
        items: [{ question: "Is this clinical?", answer: "No." }],
      },
    ];
    expect(protectedTitleWarnings(blocks)).toContain("clinical");
  });

  it("spots an outcome claim, which is the other regulated risk", () => {
    const blocks: CourseLandingBlock[] = [
      { kind: "hero", heading: "Cures anxiety in 30 days", subheading: "", imageUrl: null },
    ];
    expect(protectedTitleWarnings(blocks).length).toBeGreaterThan(0);
  });

  it("stays quiet on ordinary teaching copy", () => {
    const blocks: CourseLandingBlock[] = [
      { kind: "method", heading: "How I teach", body: "Short lessons, practised daily." },
    ];
    expect(protectedTitleWarnings(blocks)).toEqual([]);
  });

  // It returns findings; it does not filter. A teacher with a real licence must
  // still be able to say so.
  it("does not modify the blocks it inspects", () => {
    const blocks: CourseLandingBlock[] = [
      { kind: "method", heading: "H", body: "I am a licensed psychologist." },
    ];
    const before = JSON.stringify(blocks);
    protectedTitleWarnings(blocks);
    expect(JSON.stringify(blocks)).toBe(before);
  });
});
