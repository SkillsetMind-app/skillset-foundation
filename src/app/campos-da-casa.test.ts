import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// C-05: the last fields with a hand-copied skin (thin 1px border in
// --color-line, which disappeared on the white card, and heights from 38 to 46px) moved
// to the house field, the .field-input. Source read, as in revisao-pr494:
// jsdom does not paint, so what can be proven is the class in place and that the
// field still has a name (the tests of each screen that look up by label
// check the real name).

const read = (path: string) => readFileSync(join(process.cwd(), "src/components", path), "utf8");

// The opening tag that contains `needle`, skipping the `>` inside {...}.
function tagAround(source: string, needle: string) {
  const at = source.indexOf(needle);
  expect(at, `snippet not found: ${needle}`).toBeGreaterThan(-1);
  expect(source.indexOf(needle, at + 1), `trecho repetido: ${needle}`).toBe(-1);
  return tagAt(source, source.lastIndexOf("<", at));
}

function tagAt(source: string, start: number) {
  let depth = 0;
  let end = start;
  for (; end < source.length; end += 1) {
    const char = source[end];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) break;
  }
  return { start, tag: source.slice(start, end + 1) };
}

// The field class, opening the local constant when it is used.
function classOf(source: string, tag: string) {
  const literal = /className="([^"]*)"/.exec(tag)?.[1];
  if (literal !== undefined) return literal;
  const expression = /className=\{`?\$?\{?(\w+)\}?([^}]*)\}/.exec(tag);
  expect(expression, tag).not.toBeNull();
  const constant = new RegExp(`const ${expression![1]} =\\s*"([^"]*)"`).exec(source)?.[1];
  expect(constant, `${expression![1]} has no literal value`).toBeDefined();
  return `${constant} ${expression![2]}`;
}

function hasName(source: string, start: number, tag: string) {
  if (/aria-label=|\{\.\.\.a11y\}/.test(tag)) return true;
  const id = /\bid=(\{[^}]+\}|"[^"]+")/.exec(tag)?.[1];
  if (id && source.includes(`htmlFor=${id}`)) return true;
  const label = source.lastIndexOf("<label", start);
  return label > -1 && source.indexOf("</label>", label) > start;
}

const fields: [file: string, needle: string][] = [
  ["teacher/course-commerce-panels.tsx", "value={code}"],
  ["teacher/course-commerce-panels.tsx", "value={percentOff}"],
  ["teacher/course-commerce-panels.tsx", "value={maxRedemptionsText}"],
  ["teacher/course-commerce-panels.tsx", "value={expiresOn}"],
  ["teacher/course-commerce-panels.tsx", "value={registrationId}"],
  ["teacher/member-area-settings-panel.tsx", "setName(event.target.value)} className={fieldClass}"],
  ["teacher/member-area-settings-panel.tsx", "value={slug}"],
  ["teacher/member-area-settings-panel.tsx", "placeholder={creator.name}"],
  ["teacher/member-area-settings-panel.tsx", "value={welcome}"],
  ["teacher/member-area-settings-panel.tsx", "addToArea(event.target.value)"],
  ["teacher/member-area-settings-panel.tsx", "value={chosenCommunity}"],
  ["teacher/sales-page-editor.tsx", "setTitle(e.target.value)"],
  ["teacher/sales-page-editor.tsx", "setSummary(e.target.value)"],
  ["teacher/sales-page-editor.tsx", "setOutcomesText(e.target.value)"],
  ["teacher/course-landing-editor.tsx", "subheading: e.target.value"],
  ["teacher/landing-image-field.tsx", "e.target.value.trim() || null"],
  ["teacher/teacher-event-studio.tsx", 'type="date"'],
  ["teacher/teacher-event-studio.tsx", 'type="time"'],
  ["teacher/creator-subscription-center.tsx", "setQuery(event.target.value)"],
  ["teacher/creator-subscription-center.tsx", "setFilter(event.target.value as SubscriberFilter)"],
  ["teacher/teacher-connect-onboarding.tsx", 'id="payout-country"'],
  ["teacher/teacher-messages-inbox.tsx", 'aria-label={t("teacherMessages.replyTo")'],
  ["teacher/course-asset-uploader.tsx", "setKind(event.target.value as CourseAssetKind)"],
  ["teacher/course-asset-uploader.tsx", "setModuleId(event.target.value)"],
  ["teacher/course-access-panel.tsx", 'id={inputId} type="email"'],
  ["teacher/course-manage-hub.tsx", 'aria-label={t("creatorPanel.hub.header.switchCourse")}'],
  ["learn/course-messages-panel.tsx", 'aria-label={t("learn.classroom.messages.bodyLabel")}'],
  ["learn/course-review-panel.tsx", 'aria-label={t("learn.classroom.review.bodyLabel")}'],
  ["learn/learn-community-hub.tsx", 'placeholder={t("learnWave2.communityHub.placeholder")}'],
  ["learn/learn-credentials-hub.tsx", 'placeholder={t("learnWave2.credentials.namePlaceholder")}'],
  ["learn/student-messages-inbox.tsx", 'id="student-message-draft"'],
  ["learn/lesson-comments.tsx", 'placeholder={t("learn.classroom.lessonComments.prompt")}'],
  ["certificates/certificate-verification-panel.tsx", 'aria-label={t("learnWave2.verification.codeLabel")}'],
  // The course builder and the start of the new course.
  ["teacher/course-builder-studio.tsx", "chooseFreePreviewLesson(event.target.value)"],
  ["teacher/course-builder-studio.tsx", "updateModuleTitle(module.id, event.target.value)"],
  ["teacher/course-builder-studio.tsx", "updateModuleSummary(module.id, event.target.value)"],
  ["teacher/course-builder-studio.tsx", 'aria-describedby={error?.code === "lessonTitle"'],
  ["teacher/course-builder-studio.tsx", "setTitle(event.target.value)"],
  ["teacher/course-builder-studio.tsx", "setSummary(event.target.value)"],
  ["teacher/course-builder-studio.tsx", 'placeholder={t("creatorEditor.builder.details.outcomePlaceholder")}'],
  ["teacher/course-builder-studio.tsx", 'id="builder-price"'],
  ["teacher/course-builder-studio.tsx", 'id="builder-installments"'],
  ["teacher/course-builder-studio.tsx", "setYearlyAmount(event.target.value)"],
  ["teacher/course-builder-studio.tsx", "setModuleTitle(event.target.value)"],
  ["teacher/course-builder-studio.tsx", "setModuleSummary(event.target.value)"],
  ["teacher/course-builder-studio.tsx", "setDripStrategy(event.target.value as DripStrategy)"],
  ["teacher/course-builder-studio.tsx", "setDripIntervalDays(event.target.value)"],
  ["teacher/course-builder-studio.tsx", "onTitleChange(event.target.value)"],
  ["teacher/course-builder-studio.tsx", "onSubtitleChange(event.target.value)"],
  ["teacher/course-builder-studio.tsx", "onDescriptionChange(event.target.value)"],
  ["teacher/create-course-start.tsx", "setTitle(event.target.value)"],
  ["teacher/create-course-start.tsx", "setEventDate(event.target.value)"],
  ["teacher/create-course-start.tsx", "setEventTime(event.target.value)"],
  ["teacher/create-course-start.tsx", "setEventLink(event.target.value)"],
  ["teacher/create-course-start.tsx", "setSummary(event.target.value)"],
];

// In these three files, the fields that keep their own skin on purpose.
// Any other field with the hand-made thin border breaks the test below.
const ownSkin: [file: string, needle: string, reason: string][] = [
  [
    "teacher/course-builder-studio.tsx",
    "title: event.target.value,",
    "título da aula na linha do currículo: editado no lugar, em negrito, ao lado de botões de 44px",
  ],
  [
    "teacher/course-builder-studio.tsx",
    'value={moveTargets[lesson.id] ?? ""}',
    "mover para outro módulo: seletor de 12px na fileira de botões de 44px da aula",
  ],
  [
    "teacher/lesson-content-modal.tsx",
    "defaultValue={title}",
    "nome do material: dentro de .lesson-modal-assets, que tem regras próprias no globals.css",
  ],
];

const lineOf = (source: string, at: number) => source.slice(0, at).split("\n").length;

describe("C-05: fields on the house .field-input", () => {
  it.each(fields)("%s: the %s field uses the house skin and has a name", (file, needle) => {
    const source = read(file);
    const { start, tag } = tagAround(source, needle);
    const classes = classOf(source, tag);
    expect(classes, tag).toMatch(/\bfield-input\b/);
    expect(classes, tag).not.toContain("border-[var(--color-line)]");
    expect(classes, tag).not.toMatch(/\bbg-white\b/);
    expect(hasName(source, start, tag), `${file}: field without an accessible name`).toBe(true);
  });

  it("the currency selector is born with the house skin", () => {
    const source = read("teacher/currency-select.tsx");
    expect(/currencySelectClassName =\s*"([^"]*)"/.exec(source)?.[1]).toMatch(/^field-input\b/);
  });

  // Date and time larger than the other fields: 48px and 16px, over the 14px
  // of the .field-input (which is outside any layer, hence the `!`).
  it("date and time in the events studio are larger", () => {
    expect(read("teacher/teacher-event-studio.tsx")).toContain('const whenFieldClass = "field-input min-h-12 text-base!";');
  });

  it.each(["teacher/course-builder-studio.tsx", "teacher/create-course-start.tsx", "teacher/lesson-content-modal.tsx"])(
    "%s: no field with a hand-made skin outside the exceptions",
    (file) => {
      const source = read(file);
      const expected = ownSkin
        .filter(([owner]) => owner === file)
        .map(([, needle]) => lineOf(source, tagAround(source, needle).start));
      const handSkinned: number[] = [];
      for (const match of source.matchAll(/<(?:input|select|textarea)\b/g)) {
        const classes = /className="([^"]*)"/.exec(tagAt(source, match.index).tag)?.[1] ?? "";
        if (/\bbg-white\b|border-\[var\(--color-(?:line|field-border)\)\]/.test(classes)) {
          handSkinned.push(lineOf(source, match.index));
        }
      }
      expect(handSkinned, file).toEqual(expected.sort((a, b) => a - b));
    },
  );

  // The release days field is narrow (80px): the `width: 100%` of the
  // .field-input is outside any layer and would beat the w-20 without the `!`.
  it("the release days field stays narrow", () => {
    expect(read("teacher/course-builder-studio.tsx")).toContain(
      'className="field-input w-20! text-center disabled:cursor-not-allowed disabled:opacity-60"',
    );
  });

  // The .field-input rests on light gray and has no :disabled rule: without the
  // house pair (the same as the currency selector), a locked field looks free.
  // For now it applies to the builder and the start of the course.
  const builderFields = fields.filter(([file]) =>
    ["teacher/course-builder-studio.tsx", "teacher/create-course-start.tsx"].includes(file),
  );
  it.each(builderFields)("%s: the %s field, when locked, is faded", (file, needle) => {
    const source = read(file);
    const { tag } = tagAround(source, needle);
    if (!/\sdisabled[=\s>]/.test(tag)) return;
    const classes = classOf(source, tag);
    expect(classes, tag).toContain("disabled:cursor-not-allowed");
    expect(classes, tag).toContain("disabled:opacity-60");
  });

  // The label of the sales page editor was the 12px uppercase tag;
  // now it is the <Field>'s (14px, bold, sentence case).
  it.each(["teacher/course-landing-editor.tsx", "teacher/sales-page-editor.tsx", "teacher/landing-image-field.tsx"])(
    "%s: field labels without uppercase",
    (file) => {
      const source = read(file);
      for (const label of source.matchAll(/<label className="([^"]*)"/g)) {
        expect(label[1], file).not.toContain("uppercase");
      }
      expect(source).not.toMatch(/text-xs font-(?:bold|semibold) uppercase/);
    },
  );
});
