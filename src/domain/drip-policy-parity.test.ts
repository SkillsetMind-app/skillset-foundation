import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getLessonUnlockState } from "@/domain/drip-policy";
import {
  type DripParityCase,
  dripParityCases,
  dripParityCourses,
  dripParityModules,
  dripParityPreviewLessonId,
  toSqlTuple,
} from "@/domain/drip-policy-parity-cases";

// A liberação da aula vale em dois lugares: no JS (rota do vídeo e a sala de
// aula) e no banco (public.lesson_is_released, nas policies de texto, link e
// material). Os dois têm de responder igual. Este teste roda a tabela no JS e
// confere que o smoke SQL roda a MESMA tabela; o smoke roda ela no banco.
const smokePath = join(
  process.cwd(),
  "supabase",
  "tests",
  "20260915020000_liberacao_da_aula_no_banco_smoke.sql",
);
const now = new Date("2026-03-01T12:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

// O mesmo caminho de isLessonDripLocked (src/app/api/courses/video-token):
// instant abre antes de tudo, aula fora do currículo abre, e a aula de amostra
// é a free_preview_lesson_id do curso.
function releasedLikeTheRoute(item: DripParityCase): boolean {
  const course = { ...dripParityCourses[item.course], modules: dripParityModules };
  if ((course.dripStrategy ?? "instant") === "instant") {
    return true;
  }
  const lesson = dripParityModules
    .flatMap((module) => module.lessons)
    .find((candidate) => candidate.id === item.lessonId);
  if (!lesson) {
    return true;
  }
  return getLessonUnlockState(
    course,
    { ...lesson, isPreview: lesson.id === dripParityPreviewLessonId },
    item.enrolledDaysAgo === null
      ? null
      : { createdAt: new Date(now.getTime() - item.enrolledDaysAgo * dayMs) },
    item.completedLessonIds,
    now,
  ).unlocked;
}

describe("liberação da aula: JS e banco com a mesma tabela", () => {
  it.each(dripParityCases)("$name", (item) => {
    expect(releasedLikeTheRoute(item)).toBe(item.released);
  });

  it("o smoke SQL roda exatamente estes casos", () => {
    const smoke = readFileSync(smokePath, "utf8");
    const block = smoke.split("-- drip-parity-cases:begin")[1]?.split("-- drip-parity-cases:end")[0] ?? "";
    const sqlTuples = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("("))
      .map((line) => line.replace(/[,;]$/, ""));

    expect(sqlTuples.sort()).toEqual(dripParityCases.map(toSqlTuple).sort());
  });

  it("o smoke SQL monta o mesmo currículo e as mesmas estratégias", () => {
    const smoke = readFileSync(smokePath, "utf8");
    for (const lesson of dripParityModules.flatMap((module) => module.lessons)) {
      expect(smoke).toContain(`'id', p || '-${lesson.id}', 'dripDelayDays', ${lesson.dripDelayDays})`);
    }
    expect(smoke).toContain(`k.key || '-${dripParityPreviewLessonId}'`);
    for (const [key, course] of Object.entries(dripParityCourses)) {
      const strategy = course.dripStrategy ? `'${course.dripStrategy}'` : "null";
      expect(smoke).toContain(`('${key}', ${strategy}, ${course.dripIntervalDays ?? "null"})`);
    }
  });
});
