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
  // O construtor do curso e o começo do curso novo.
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

// Nesses três arquivos, os campos que ficam com pele própria de propósito.
// Qualquer outro campo com a borda fina à mão derruba o teste de baixo.
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

  it.each(["teacher/course-builder-studio.tsx", "teacher/create-course-start.tsx", "teacher/lesson-content-modal.tsx"])(
    "%s: nenhum campo com a pele à mão fora das exceções",
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

  // O campo de dias da liberação é estreito (80px): o `width: 100%` do
  // .field-input fica fora de camada e venceria o w-20 sem o `!`.
  it("o campo de dias da liberação continua estreito", () => {
    expect(read("teacher/course-builder-studio.tsx")).toContain(
      'className="field-input w-20! text-center disabled:cursor-not-allowed disabled:opacity-60"',
    );
  });

  // O .field-input descansa no cinza claro e não tem regra de :disabled: sem o
  // par da casa (o mesmo do seletor de moeda), um campo travado parece livre.
  // Por ora vale para o construtor e o começo do curso.
  const builderFields = fields.filter(([file]) =>
    ["teacher/course-builder-studio.tsx", "teacher/create-course-start.tsx"].includes(file),
  );
  it.each(builderFields)("%s: o campo de %s, se trava, fica apagado", (file, needle) => {
    const source = read(file);
    const { tag } = tagAround(source, needle);
    if (!/\sdisabled[=\s>]/.test(tag)) return;
    const classes = classOf(source, tag);
    expect(classes, tag).toContain("disabled:cursor-not-allowed");
    expect(classes, tag).toContain("disabled:opacity-60");
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
