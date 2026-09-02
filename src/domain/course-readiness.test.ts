import { describe, expect, it } from "vitest";

import {
  getCourseReadiness,
  type CourseReadinessInput,
} from "@/domain/course-readiness";

const lesson = { id: "l1", title: "Welcome", type: "video" as const, description: "" };

const complete: CourseReadinessInput = {
  title: "Clinical performance foundations",
  summary: "Build a repeatable practice for evidence-informed performance work.",
  category: "Applied Psychology & Behavior",
  categories: ["Applied Psychology & Behavior"],
  modules: [{ id: "m1", title: "Start here", lessons: [lesson] }],
  priceAmountMinor: 14900,
  paymentType: "one_time",
};

describe("getCourseReadiness", () => {
  // O professor via tres listas de "o que falta" com tres numeros diferentes
  // para o mesmo curso. A prova de que agora ha uma regra: a mesma entrada
  // devolve exatamente a mesma lista, sempre.
  it("devolve a mesma lista para a mesma entrada", () => {
    const first = getCourseReadiness(complete);
    const second = getCourseReadiness({ ...complete });
    expect(second).toEqual(first);
  });

  it("um curso sem preco e sem aula lista as duas pendencias, nessa ordem", () => {
    const readiness = getCourseReadiness({
      ...complete,
      modules: [{ id: "m1", title: "Start here", lessons: [] }],
      priceAmountMinor: null,
    });

    expect(readiness.pending.map((item) => item.id)).toEqual(["lesson", "pricing"]);
    expect(readiness.next?.hint).toBe("Add at least one lesson.");
    expect(readiness.ready).toBe(false);
    // 4 de 6 obrigatorios: titulo, resumo, categoria e modulo.
    expect(readiness.doneCount).toBe(4);
    expect(readiness.total).toBe(6);
    expect(readiness.percent).toBe(67);
  });

  it("um curso completo devolve lista vazia e 100%", () => {
    const readiness = getCourseReadiness(complete);

    expect(readiness.pending).toEqual([]);
    expect(readiness.next).toBeNull();
    expect(readiness.percent).toBe(100);
    expect(readiness.ready).toBe(true);
  });

  // Regra mais exigente entre as telas: o construtor aceitava titulo de 1
  // letra; o formulario de criacao e o Manage pediam 3. Curso que uma tela
  // dizia incompleto nao pode aparecer 100% em outra.
  it("exige titulo com 3+ caracteres, como o Manage ja exigia", () => {
    const readiness = getCourseReadiness({ ...complete, title: "AB" });
    expect(readiness.pending.map((item) => item.id)).toEqual(["title"]);
  });

  it("gratuito dispensa preco; pago exige valor acima de zero", () => {
    expect(
      getCourseReadiness({ ...complete, paymentType: "free", priceAmountMinor: 0 }).ready,
    ).toBe(true);
    expect(
      getCourseReadiness({ ...complete, priceAmountMinor: 0 }).pending.map((i) => i.id),
    ).toEqual(["pricing"]);
  });

  // Parcelamento so conta quando existe: listar "Payment model is ready" num
  // curso gratuito era um item feito de graca que inflava a porcentagem.
  it("so cobra limite de parcelas na venda avulsa com parcelamento ligado", () => {
    const withoutLimit = getCourseReadiness({
      ...complete,
      installmentsEnabled: true,
      installmentsMax: null,
    });
    expect(withoutLimit.pending.map((item) => item.id)).toEqual(["installments"]);

    const free = getCourseReadiness({
      ...complete,
      paymentType: "free",
      installmentsEnabled: true,
      installmentsMax: null,
    });
    expect(free.items.some((item) => item.id === "installments")).toBe(false);
  });

  // Capa e resultados de aprendizagem ajudam a vender mas nao travam a
  // publicacao: aparecem na lista, marcados como opcionais, fora da conta.
  it("lista capa e resultados como opcionais, fora da porcentagem", () => {
    const readiness = getCourseReadiness(complete);
    const optional = readiness.items.filter((item) => item.optional).map((i) => i.id);

    expect(optional).toEqual(["cover", "outcomes"]);
    expect(readiness.percent).toBe(100);
  });

  // O Manage exigia payouts do Stripe para curso pago e a verificacao
  // profissional quando obrigatoria; o construtor nao sabia disso e deixava
  // clicar em Publish para descobrir pelo erro. Com o perfil na mao, a
  // mesma funcao cobra as duas travas.
  it("com dados da conta, cobra payouts no curso pago e verificacao quando exigida", () => {
    const readiness = getCourseReadiness(complete, {
      payoutsReady: false,
      verificationRequired: true,
      verificationApproved: false,
    });

    expect(readiness.pending.map((item) => item.id)).toEqual(["payouts", "verification"]);
    expect(readiness.percent).toBe(75);
  });

  it("curso gratuito nao pede payouts; verificacao nao exigida vira opcional", () => {
    const readiness = getCourseReadiness(
      { ...complete, paymentType: "free", priceAmountMinor: 0 },
      { payoutsReady: false, verificationRequired: false, verificationApproved: false },
    );

    expect(readiness.items.some((item) => item.id === "payouts")).toBe(false);
    expect(readiness.items.find((item) => item.id === "verification")?.optional).toBe(true);
    expect(readiness.ready).toBe(true);
  });
});
