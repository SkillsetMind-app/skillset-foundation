import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// C-05: os últimos campos com a pele copiada à mão (borda fina de 1px em
// --color-line, que sumia no cartão branco, e alturas de 38 a 46px) passaram
// ao campo da casa, o .field-input. Leitura do fonte, como em revisao-pr494:
// o jsdom não pinta, então o que dá para provar é a classe no lugar e que o
// campo continua com nome (os testes de cada tela que buscam por rótulo
// conferem o nome de verdade).

const read = (path: string) => readFileSync(join(process.cwd(), "src/components", path), "utf8");

// A tag de abertura que contém `needle`, pulando os `>` de dentro de {...}.
function tagAround(source: string, needle: string) {
  const at = source.indexOf(needle);
  expect(at, `trecho nao encontrado: ${needle}`).toBeGreaterThan(-1);
  expect(source.indexOf(needle, at + 1), `trecho repetido: ${needle}`).toBe(-1);
  const start = source.lastIndexOf("<", at);
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

// A classe do campo, abrindo a constante local quando ela é usada.
function classOf(source: string, tag: string) {
  const literal = /className="([^"]*)"/.exec(tag)?.[1];
  if (literal !== undefined) return literal;
  const expression = /className=\{`?\$?\{?(\w+)\}?([^}]*)\}/.exec(tag);
  expect(expression, tag).not.toBeNull();
  const constant = new RegExp(`const ${expression![1]} =\\s*"([^"]*)"`).exec(source)?.[1];
  expect(constant, `${expression![1]} sem valor literal`).toBeDefined();
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
];

describe("C-05: campos no .field-input da casa", () => {
  it.each(fields)("%s: o campo de %s usa a pele da casa e tem nome", (file, needle) => {
    const source = read(file);
    const { start, tag } = tagAround(source, needle);
    const classes = classOf(source, tag);
    expect(classes, tag).toMatch(/\bfield-input\b/);
    expect(classes, tag).not.toContain("border-[var(--color-line)]");
    expect(classes, tag).not.toMatch(/\bbg-white\b/);
    expect(hasName(source, start, tag), `${file}: campo sem nome acessível`).toBe(true);
  });

  it("o seletor de moeda nasce com a pele da casa", () => {
    const source = read("teacher/currency-select.tsx");
    expect(/currencySelectClassName =\s*"([^"]*)"/.exec(source)?.[1]).toMatch(/^field-input\b/);
  });

  // Data e hora maiores que os outros campos: 48px e 16px, por cima do 14px
  // do .field-input (que fica fora de camada, daí o `!`).
  it("data e hora do estúdio de eventos ficam maiores", () => {
    expect(read("teacher/teacher-event-studio.tsx")).toContain('const whenFieldClass = "field-input min-h-12 text-base!";');
  });

  // O rótulo do editor da página de venda era a etiqueta de 12px em caixa
  // alta; agora é o do <Field> (14px, negrito, em frase).
  it.each(["teacher/course-landing-editor.tsx", "teacher/sales-page-editor.tsx", "teacher/landing-image-field.tsx"])(
    "%s: rótulos de campo sem caixa alta",
    (file) => {
      const source = read(file);
      for (const label of source.matchAll(/<label className="([^"]*)"/g)) {
        expect(label[1], file).not.toContain("uppercase");
      }
      expect(source).not.toMatch(/text-xs font-(?:bold|semibold) uppercase/);
    },
  );
});
