import { describe, expect, it } from "vitest";

import { moveLessonTo } from "@/domain/curriculum-move";
import type { TeacherCourseModule, TeacherLesson } from "@/domain/teacher-course";

// Aula com os campos que sairam da tela (duracao, dias de espera, texto): eles
// tem de viajar junto, porque a RPC de troca total zera o que nao vier.
function lesson(id: string): TeacherLesson {
  return {
    id,
    title: id.toUpperCase(),
    type: "video",
    description: "nota antiga",
    durationMinutes: 7,
    dripDelayDays: 3,
    contentText: "corpo",
    externalUrl: null,
  };
}

function fixture(): TeacherCourseModule[] {
  return [
    { id: "m1", title: "M1", lessons: [lesson("l1"), lesson("l2")] },
    { id: "m2", title: "M2", lessons: [lesson("l3")] },
  ];
}

const ids = (module: TeacherCourseModule) => module.lessons.map((item) => item.id);

describe("moveLessonTo", () => {
  it("leva L2 de M1 para o comeco de M2 como o mesmo objeto, com o mesmo id", () => {
    const modules = fixture();
    const l2 = modules[0].lessons[1];
    const course = { freePreviewLessonId: "l2", modules };

    const next = moveLessonTo(course.modules, "l2", "m2", 0);

    expect(ids(next[0])).toEqual(["l1"]);
    expect(ids(next[1])).toEqual(["l2", "l3"]);
    expect(next[1].lessons[0]).toBe(l2);
    expect(next[1].lessons[0]).toEqual(lesson("l2"));
    // A previa gratis e do curso, pelo id: nao muda com a mudanca de modulo.
    expect(course.freePreviewLessonId).toBe("l2");
    // A entrada nao e mutada (o React compara por referencia).
    expect(ids(modules[0])).toEqual(["l1", "l2"]);
    expect(ids(modules[1])).toEqual(["l3"]);
  });

  it("indice fora da faixa cai na ponta mais proxima", () => {
    expect(ids(moveLessonTo(fixture(), "l1", "m2", 99)[1])).toEqual(["l3", "l1"]);
    expect(ids(moveLessonTo(fixture(), "l1", "m2", -5)[1])).toEqual(["l1", "l3"]);
    expect(ids(moveLessonTo(fixture(), "l1", "m2", Number.NaN)[1])).toEqual(["l1", "l3"]);
  });

  it("reordena dentro do mesmo modulo", () => {
    expect(ids(moveLessonTo(fixture(), "l2", "m1", 0)[0])).toEqual(["l2", "l1"]);
  });

  it("mesma posicao, aula ou modulo inexistentes: devolve o proprio array", () => {
    const modules = fixture();
    expect(moveLessonTo(modules, "l2", "m1", 1)).toBe(modules);
    expect(moveLessonTo(modules, "l2", "m1", 50)).toBe(modules);
    expect(moveLessonTo(modules, "ghost", "m2", 0)).toBe(modules);
    expect(moveLessonTo(modules, "l2", "ghost", 0)).toBe(modules);
  });
});
