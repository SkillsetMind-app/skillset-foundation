// @vitest-environment node
//
// The interface copy may not sell to a regulated audience. This is a source
// test rather than a render test because the mistake is a word, not a layout:
// it comes back through a translation, a tagline rewrite, or an eyebrow that
// nobody re-reads. It has already come back once.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Protected titles and scope-of-practice terms in all 50 US states. Naming
// them as the AUDIENCE implies the platform is a place to practise, which is
// the claim that needs a licence — separately from whatever a seller actually
// teaches. Psychology as a SUBJECT is fine and deliberately absent from this
// list; see the comment at the top of src/domain/teacher-course.ts.
//
// "Psychologist" / "psicólogo" were on this list until 2026-08-29 and are the
// owner's deliberate exception: the marketing copy names psychologists as the
// audience it sells to. The words that describe DELIVERING care — therapist,
// psychotherapy, counselor — stay blocked, because those claim the service,
// not the reader.
const REGULATED_AUDIENCE = [
  "therapist",
  "terapeuta",
  "psychotherapy",
  "psicoterapia",
  "counselor",
  "counsellor",
  "consejero",
];

const LOCALES = ["en", "es"];

// The legal pages name the regulated service in order to DENY it: the terms say
// courses are "not psychotherapy" and the teacher terms forbid creating a
// "therapist-client" relationship. That text was already public, written
// straight into the page components, where this scan never looked; it only
// reached the dictionary when the pages were translated. Denying the service is
// the opposite of selling to a licensed audience, so these keys stay out of the
// scan below and get a positive check instead: the denial must stay.
const LEGAL_PREFIX = "legalPages.";

function everyString(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      everyString(v, path ? `${path}.${k}` : k),
    );
  }
  return [];
}

describe("interface copy names no regulated audience", () => {
  it.each(LOCALES)("keeps %s.json clear of protected titles", (locale) => {
    const source = JSON.parse(
      readFileSync(join(process.cwd(), "src", "data", "i18n", `${locale}.json`), "utf8"),
    );

    const offenders = everyString(source)
      .filter(([path]) => !path.startsWith(LEGAL_PREFIX))
      .flatMap(([path, text]) => {
      const lower = text.toLowerCase();
      const found = REGULATED_AUDIENCE.filter((term) => lower.includes(term));
      return found.length ? [`${path}: ${found.join(", ")} — "${text.slice(0, 90)}"`] : [];
    });

    expect(
      offenders,
      `These strings address a licensed audience. Say coaches, facilitators, mentors or personal-development experts instead:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it.each([
    ["en", "not psychotherapy", "you may not use"],
    ["es", "no son psicoterapia", "no puedes utilizar"],
  ])("keeps the %s legal pages denying the regulated service", (locale, termsDenial, teacherDenial) => {
    const source = JSON.parse(
      readFileSync(join(process.cwd(), "src", "data", "i18n", `${locale}.json`), "utf8"),
    );

    expect(source.legalPages.terms.text10.toLowerCase()).toContain(termsDenial);
    expect(source.legalPages.teacherTerms.text11.toLowerCase()).toContain(teacherDenial);
  });
});
