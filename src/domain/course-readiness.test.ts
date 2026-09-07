import { describe, expect, it } from "vitest";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

import {
  getCourseReadiness,
  groupCourseReadiness,
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
  it.each([false, true])("localizes every check without changing publication gates (paid: %s)", (paid) => {
    const input = {
      ...complete,
      paymentType: paid ? "one_time" as const : "free" as const,
      priceAmountMinor: paid ? 14900 : 0,
      installmentsEnabled: true,
      installmentsMax: null,
    };
    const account = { payoutsReady: false, verificationRequired: paid, verificationApproved: false };
    const legacy = getCourseReadiness(input, account);
    const en = getCourseReadiness(input, account, (key) => translate(getDictionary("en"), key));
    const es = getCourseReadiness(input, account, (key) => translate(getDictionary("es"), key));
    const gates = (result: typeof legacy) => ({
      items: result.items.map(({ id, done, optional }) => ({ id, done, optional })),
      pending: result.pending.map(({ id }) => id),
      next: result.next?.id,
      doneCount: result.doneCount,
      total: result.total,
      percent: result.percent,
      ready: result.ready,
    });
    expect(en).toEqual(legacy);
    expect(gates(es)).toEqual(gates(legacy));
    expect(es.items.find(({ id }) => id === "title")?.label).toBe("Título del curso");
    expect(es.items.find(({ id }) => id === "title")?.hint).toBe("Dale al curso un título de al menos 3 caracteres.");
    expect(es.items.find(({ id }) => id === "verification")?.hint).toBe(paid
      ? "Completa la verificación profesional antes de publicar."
      : "Hoy es opcional; será obligatoria cuando se abra la admisión profesional.");
    for (const item of es.items) {
      expect(item.label).not.toBe(legacy.items.find(({ id }) => id === item.id)?.label);
      expect(item.hint).not.toBe(legacy.items.find(({ id }) => id === item.id)?.hint);
      expect(item.label).not.toContain("creatorEditor.");
      expect(item.hint).not.toContain("creatorEditor.");
    }
  });

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

// A barra "N de M" somava titulo, capa e repasse do Stripe como se fossem a
// mesma coisa; a pessoa nao sabia se estava travada no conteudo, na pagina ou
// no dinheiro. O recorte em tres grupos e so leitura: mesmos ids, mesmo
// total, mesmo `ready`.
describe("groupCourseReadiness", () => {
  const partial: CourseReadinessInput = {
    ...complete,
    modules: [{ id: "m1", title: "Start here", lessons: [] }],
    priceAmountMinor: null,
  };
  const account = { payoutsReady: false, verificationRequired: true, verificationApproved: false };

  it("separa conteudo, pagina e venda, nessa ordem, com contagem so dos obrigatorios", () => {
    const readiness = getCourseReadiness(partial, account);
    const groups = groupCourseReadiness(readiness);

    expect(groups.map((group) => group.id)).toEqual(["content", "page", "sale"]);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["title", "module", "lesson"],
      ["summary", "category", "cover", "outcomes"],
      ["pricing", "verification"],
    ]);
    // Capa e resultados sao opcionais: aparecem na pagina, ficam fora do 2 de 2.
    expect(groups.map((group) => [group.doneCount, group.total, group.ready])).toEqual([
      [2, 3, false],
      [2, 2, true],
      [0, 2, false],
    ]);
  });

  it("a soma dos grupos bate com o geral e nada do contrato antigo muda", () => {
    const readiness = getCourseReadiness(partial, account);
    const groups = groupCourseReadiness(readiness);

    expect(groups.reduce((sum, group) => sum + group.doneCount, 0)).toBe(readiness.doneCount);
    expect(groups.reduce((sum, group) => sum + group.total, 0)).toBe(readiness.total);
    expect(groups.flatMap((group) => group.items)).toHaveLength(readiness.items.length);
    expect(readiness.pending.map((item) => item.id)).toEqual(["lesson", "pricing", "verification"]);
    expect(readiness.percent).toBe(57);
    expect(readiness.ready).toBe(false);
  });

  it("parcelas e repasses do curso pago caem em venda; verificacao opcional nao conta", () => {
    const readiness = getCourseReadiness(
      { ...complete, installmentsEnabled: true, installmentsMax: 6 },
      { payoutsReady: true, verificationRequired: false, verificationApproved: false },
    );
    const [content, page, sale] = groupCourseReadiness(readiness);

    expect(sale.items.map((item) => item.id)).toEqual(["pricing", "installments", "payouts", "verification"]);
    expect([sale.doneCount, sale.total, sale.ready]).toEqual([3, 3, true]);
    expect(content.ready).toBe(true);
    expect(page.ready).toBe(true);
    expect(readiness.ready).toBe(true);
  });

  it("todo item carrega o grupo e a traducao nao o altera", () => {
    const en = getCourseReadiness(partial, account);
    const es = getCourseReadiness(partial, account, (key) => translate(getDictionary("es"), key));

    expect(en.items.map((item) => item.group)).toEqual(es.items.map((item) => item.group));
    expect(en.items.every((item) => ["content", "page", "sale"].includes(item.group))).toBe(true);
    expect(groupCourseReadiness(es).map((group) => group.doneCount)).toEqual(
      groupCourseReadiness(en).map((group) => group.doneCount),
    );
  });

  it("sem conta e curso gratis, venda so tem preco e ja nasce pronta", () => {
    const readiness = getCourseReadiness({ ...complete, paymentType: "free", priceAmountMinor: 0 });
    const sale = groupCourseReadiness(readiness)[2];

    expect(sale.items.map((item) => item.id)).toEqual(["pricing"]);
    expect([sale.doneCount, sale.total, sale.ready]).toEqual([1, 1, true]);
  });
});
