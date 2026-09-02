import { describe, expect, it } from "vitest";

import {
  classroomBasePath,
  classroomTabHref,
  isClassroomTab,
} from "@/domain/classroom-tabs";

// Reanalise item 9: cada aba da sala e um endereco, e a aula atual vai junto.

describe("abas da sala de aula: endereco proprio", () => {
  it("a aba e a propria base; as outras ganham um segmento — e a aula vai junto", () => {
    const base = "/learn/courses/lideranca";

    expect(classroomTabHref(base, "lesson", "aula-5")).toBe("/learn/courses/lideranca?lesson=aula-5");
    expect(classroomTabHref(base, "community", "aula-5")).toBe(
      "/learn/courses/lideranca/community?lesson=aula-5",
    );
    // Sem aula escolhida ainda (primeira visita), sem parametro.
    expect(classroomTabHref(base, "about", null)).toBe("/learn/courses/lideranca/about");
  });

  it("o id da aula vai escapado no endereco", () => {
    expect(classroomTabHref("/learn/courses/x", "materials", "a b&c")).toBe(
      "/learn/courses/x/materials?lesson=a%20b%26c",
    );
  });

  it("a base tira o segmento da aba que esta aberta — e so ele", () => {
    expect(classroomBasePath("/learn/courses/lideranca/community", "community")).toBe(
      "/learn/courses/lideranca",
    );
    expect(classroomBasePath("/learn/courses/lideranca", "lesson")).toBe(
      "/learn/courses/lideranca",
    );
    // Um curso cujo slug termina igual ao nome de uma aba nao perde o slug.
    expect(classroomBasePath("/learn/courses/community", "lesson")).toBe(
      "/learn/courses/community",
    );
  });

  it("so os nomes conhecidos sao abas", () => {
    expect(isClassroomTab("community")).toBe(true);
    expect(isClassroomTab("banana")).toBe(false);
    expect(isClassroomTab("")).toBe(false);
  });
});
