import { describe, expect, it } from "vitest";

import { getAutosaveBlockedReason } from "@/components/teacher/course-builder-studio";

const ok = {
  isEditable: true,
  priceFieldIsValid: true,
  installmentsAreValid: true,
  draftStructureError: "",
};

describe("getAutosaveBlockedReason", () => {
  // O pior modo de falha do builder era silencioso: com um campo inválido o
  // autosave parava e a tela mostrava o MESMO selo cinza "Unsaved changes" que
  // aparece no debounce normal de 1,8s. O professor seguia montando módulos
  // achando que estava gravando, e perdia tudo ao recarregar.
  it("não bloqueia quando o rascunho está válido", () => {
    expect(getAutosaveBlockedReason(ok)).toBeNull();
  });

  it.each([
    [{ priceFieldIsValid: false }, /price/],
    [{ installmentsAreValid: false }, /installment/],
    [{ draftStructureError: "A module has no lesson." }, /structure/],
  ])("nomeia o bloqueio em vez de só parar (%o)", (override, expected) => {
    const reason = getAutosaveBlockedReason({ ...ok, ...override });
    expect(reason).toMatch(expected);
  });

  // Curso publicado/arquivado não é editável: não há rascunho para perder, e
  // um alarme aqui seria ruído permanente na barra do topo.
  it("fica calado quando o curso não é editável", () => {
    expect(
      getAutosaveBlockedReason({ ...ok, isEditable: false, priceFieldIsValid: false }),
    ).toBeNull();
  });

  // Preço é o primeiro gate, e é o que o professor mais mexe: quando mais de um
  // campo está inválido, a mensagem aponta esse — não um genérico.
  it("aponta o preço quando mais de um campo está inválido", () => {
    expect(
      getAutosaveBlockedReason({
        ...ok,
        priceFieldIsValid: false,
        installmentsAreValid: false,
      }),
    ).toMatch(/price/);
  });
});
