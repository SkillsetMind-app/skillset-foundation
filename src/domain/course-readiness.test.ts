import { describe, expect, it } from "vitest";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

import type { CourseAsset } from "@/domain/course-asset";
import {
  countLessonFiles,
  getCourseReadiness,
  getLessonIdsWithMedia,
  groupCourseReadiness,
  type CourseReadinessInput,
} from "@/domain/course-readiness";
import { getCourseMaintenanceIssues } from "@/domain/course-overview";
import type { TeacherCourse, TeacherLesson } from "@/domain/teacher-course";

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

  // Promise, Summary e Description eram o mesmo texto com tres nomes. O
  // checklist usa o nome da tela de criacao e do construtor.
  it.each([
    ["en", "Description", "Write a description with at least 20 characters."],
    ["es", "Descripción", "Escribe una descripción de al menos 20 caracteres."],
  ] as const)("o item do resumo se chama Descricao (%s)", (locale, label, hint) => {
    const readiness = getCourseReadiness(
      { ...complete, summary: "short" },
      undefined,
      (key) => translate(getDictionary(locale), key),
    );

    expect(readiness.pending[0]).toMatchObject({ id: "summary", label, hint });
  });

  // A lista de quem escolheu Gratis nao fala de preco em lugar nenhum, nem
  // como item feito: curso antigo sem paymentType e preco 0 conta como gratis.
  it.each([
    ["free", 0],
    [undefined, 0],
  ] as const)("produto gratis (paymentType %s) nao tem item de preco no checklist", (paymentType, priceAmountMinor) => {
    const account = { payoutsReady: false, verificationRequired: false, verificationApproved: false };
    const readiness = getCourseReadiness(
      { ...complete, paymentType, priceAmountMinor },
      account,
      (key) => translate(getDictionary("en"), key),
    );

    expect(readiness.items.map((item) => item.id)).not.toContain("pricing");
    expect(readiness.items.map((item) => `${item.label} ${item.hint}`).join(" ")).not.toMatch(/price/i);
    expect(readiness.ready).toBe(true);
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

  // A taxa unica so aparecia como erro do banco depois do Publish. Quem ainda
  // deve a taxa ve o item antes, com o valor da constante de planos.
  it.each([
    ["en", "Activation — US$25, one time"],
    ["es", "Activación — US$25, pago único"],
  ] as const)("lista a ativacao pendente para quem ainda deve a taxa (%s)", (locale, label) => {
    const dictionary = getDictionary(locale);
    const account = { payoutsReady: true, verificationRequired: false, verificationApproved: false };
    const blocked = getCourseReadiness(
      { ...complete, paymentType: "free", priceAmountMinor: 0 },
      { ...account, activationBlocked: true },
      (key) => translate(dictionary, key),
    );

    expect(blocked.pending.map((item) => item.id)).toEqual(["activation"]);
    expect(blocked.pending[0]).toMatchObject({ group: "sale", label, optional: false, done: false });
    expect(blocked.ready).toBe(false);
    expect(getCourseReadiness(complete, account).items.some((item) => item.id === "activation")).toBe(false);
  });

  it("sem tradutor, o rotulo da ativacao ja sai com o valor", () => {
    const readiness = getCourseReadiness(complete, {
      payoutsReady: true,
      verificationRequired: false,
      verificationApproved: false,
      activationBlocked: true,
    });

    expect(readiness.next?.label).toBe("Activation — US$25, one time");
  });
});

// Auditoria (content-publish-without-media): um curso podia ser publicado e
// vendido com aulas sem video, sem texto e sem arquivo.
describe("lessonMedia: toda aula precisa de conteudo", () => {
  const withVideo: TeacherLesson = { id: "l1", title: "Welcome", type: "video", description: "" };
  const empty: TeacherLesson = { id: "l2", title: "Empty lesson", type: "video", description: "" };
  const courseWith = (...lessons: TeacherLesson[]): CourseReadinessInput => ({
    ...complete,
    modules: [{ id: "m1", title: "Start here", lessons }],
  });
  const asset = (kind: CourseAsset["kind"], lessonId: string) => ({ kind, lessonId });
  const readinessOf = (
    course: CourseReadinessInput,
    assets: Array<Pick<CourseAsset, "kind" | "lessonId">> = [],
    t?: (key: string) => string,
  ) => getCourseReadiness({
    ...course,
    lessonIdsWithMedia: getLessonIdsWithMedia(course.modules, assets),
  }, undefined, t);

  it("2 aulas, uma com video e uma vazia: nao esta pronto e a dica cita a vazia", () => {
    const readiness = readinessOf(courseWith(withVideo, empty), [asset("lesson_video", "l1")]);

    expect(readiness.ready).toBe(false);
    expect(readiness.pending.map((item) => item.id)).toEqual(["lessonMedia"]);
    expect(readiness.next?.hint).toBe("Add a video, text or file to every lesson. Missing: Empty lesson.");
    expect(readiness.items.find((item) => item.id === "lessonMedia")?.group).toBe("content");
  });

  it("texto na aula vazia deixa pronto", () => {
    const readiness = readinessOf(
      courseWith(withVideo, { ...empty, contentText: "Read this before the next lesson." }),
      [asset("lesson_video", "l1")],
    );

    expect(readiness.ready).toBe(true);
    expect(readiness.items.find((item) => item.id === "lessonMedia")).toMatchObject({
      done: true,
      hint: "Add a video, text or file to every lesson.",
    });
  });

  it("uma aula so com PDF conta; so espacos no texto nao", () => {
    expect(readinessOf(courseWith(withVideo, empty), [
      asset("lesson_video", "l1"), asset("lesson_material", "l2"),
    ]).ready).toBe(true);
    expect(readinessOf(courseWith({ ...empty, contentText: "   " })).ready).toBe(false);
  });

  // O aluno recebe "Open resource" num link antigo (Drive etc.), e o campo de
  // link do estudio recusa esse link: sem contar aqui, o professor nunca mais
  // republicava sem reenviar o conteudo.
  it("link do YouTube/Vimeo ou link antigo (Drive) conta; link invalido ou capa da aula nao", () => {
    expect(readinessOf(courseWith({ ...empty, externalUrl: "https://vimeo.com/123456" })).ready).toBe(true);
    expect(readinessOf(courseWith({ ...empty, externalUrl: "https://drive.example.test/file/d/x/view" })).ready)
      .toBe(true);
    expect(readinessOf(courseWith({ ...empty, externalUrl: "not a link" })).ready).toBe(false);
    expect(readinessOf(courseWith(empty), [asset("lesson_thumbnail", "l2")]).ready).toBe(false);
  });

  // Aula de texto antiga: o corpo mora na descricao publica, que o aluno ve e o
  // selo Done do estudio conta. Sem contar aqui, o Publish travava enquanto o
  // painel dizia que as aulas estavam bem.
  it("aula de texto antiga, so com a descricao, conta; descricao so com espacos nao", () => {
    expect(readinessOf(courseWith({ ...empty, type: "text", description: "Read chapter 2 before the call." })).ready)
      .toBe(true);
    expect(readinessOf(courseWith({ ...empty, description: "   " })).ready).toBe(false);
  });

  it("o painel (aulas sem conteudo) e a prontidao do Publish apontam a mesma aula", () => {
    const lessons: TeacherLesson[] = [
      { id: "video", title: "Video lesson", type: "video", description: "" },
      { id: "pdf", title: "PDF only", type: "video", description: "" },
      { id: "legacy-text", title: "Legacy text", type: "text", description: "Read chapter 2." },
      { id: "drive", title: "Drive link", type: "video", description: "", externalUrl: "https://drive.example.test/file/d/x/view" },
      { id: "empty", title: "Empty lesson", type: "video", description: "" },
    ];
    const assets = [asset("lesson_video", "video"), asset("lesson_material", "pdf")];
    const course = {
      ...complete, id: "c1", ownerId: "o1", status: "draft", lessonCount: lessons.length,
      modules: [{ id: "m1", title: "Start here", lessons }],
    } as TeacherCourse;

    const panel = getCourseMaintenanceIssues({ course, assets: assets as CourseAsset[], coupons: null })
      .find((issue) => issue.id === "empty-lessons");
    const readiness = readinessOf(courseWith(...lessons), assets);

    expect(panel?.title).toBe("1 lesson has no content");
    expect(panel?.hint).toMatch(/^Empty lesson open/);
    expect(readiness.pending.map((item) => item.id)).toEqual(["lessonMedia"]);
    expect(readiness.next?.hint).toBe("Add a video, text or file to every lesson. Missing: Empty lesson.");
  });

  it("sem a lista (Manage) o item nao aparece e a porcentagem nao muda", () => {
    const readiness = getCourseReadiness(courseWith(withVideo, empty));

    expect(readiness.items.some((item) => item.id === "lessonMedia")).toBe(false);
    expect(readiness.ready).toBe(true);
    expect(readiness.percent).toBe(100);
  });

  it("sem aula nenhuma o item nao aparece: o item lesson ja cobra", () => {
    const readiness = readinessOf(courseWith());

    expect(readiness.items.some((item) => item.id === "lessonMedia")).toBe(false);
    expect(readiness.pending.map((item) => item.id)).toEqual(["lesson"]);
  });

  it("a dica cita so as tres primeiras aulas vazias, e traduz sem mexer nos titulos", () => {
    const lessons = ["Aula $& um", "Two", "", "Four"].map((title, index) => ({
      ...empty, id: `e${index}`, title,
    }));
    const en = readinessOf(courseWith(...lessons), [], (key) => translate(getDictionary("en"), key));
    const es = readinessOf(courseWith(...lessons), [], (key) => translate(getDictionary("es"), key));

    expect(en.next?.hint).toBe("Add a video, text or file to every lesson. Missing: Aula $& um, Two, Untitled lesson and 1 more.");
    expect(es.next?.label).toBe("Contenido de las lecciones");
    expect(es.next?.hint).toBe("Añade un video, texto o archivo a cada lección. Faltan: Aula $& um, Two, Lección sin título y 1 más.");
    expect(en).toEqual(readinessOf(courseWith(...lessons)));
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

  // Produto gratis nao tem preco para definir: a linha "Pricing" (com a dica
  // "Set a paid price greater than $0") era um "feito" de graca que so
  // confundia quem escolheu Gratis. Sem conta, a venda fica vazia e pronta
  // (total 0: a tela esconde a contagem em vez de dizer "0 of 0").
  it("sem conta e curso gratis, venda nao lista preco e ja nasce pronta", () => {
    const readiness = getCourseReadiness({ ...complete, paymentType: "free", priceAmountMinor: 0 });
    const sale = groupCourseReadiness(readiness)[2];

    expect(sale.items.map((item) => item.id)).toEqual([]);
    expect([sale.doneCount, sale.total, sale.ready]).toEqual([0, 0, true]);
  });
});

// O tipo gravado na criacao (courses.product_format) decide o que publicar
// cobra. Mesma regra de publish_teacher_course (20261007010000).
describe("o que cada tipo precisa entregar", () => {
  const ids = (input: CourseReadinessInput) =>
    getCourseReadiness(input).items.filter((item) => !item.optional).map((item) => item.id);
  const empty = { ...complete, modules: [], paymentType: "free" as const, priceAmountMinor: 0 };

  it("curso: modulo e aula, como antes (e sem tipo gravado, curso)", () => {
    expect(ids({ ...empty, productFormat: "course" })).toEqual(["title", "summary", "category", "module", "lesson"]);
    expect(getCourseReadiness({ ...empty, productFormat: "course" }).ready).toBe(false);
    expect(ids(empty)).toEqual(ids({ ...empty, productFormat: "course" }));
  });

  it("comunidade: aula opcional, publica sem nenhuma", () => {
    const readiness = getCourseReadiness({ ...empty, productFormat: "community", communityEnabled: true });
    expect(readiness.items.map((item) => item.id)).not.toContain("module");
    expect(readiness.items.map((item) => item.id)).not.toContain("lesson");
    expect(readiness.ready).toBe(true);
  });

  it("comunidade: aula que existe continua precisando de conteudo", () => {
    const readiness = getCourseReadiness({
      ...complete,
      productFormat: "community",
      paymentType: "subscription_monthly",
      communityEnabled: true,
      lessonIdsWithMedia: new Set<string>(),
    });
    expect(readiness.pending.map((item) => item.id)).toEqual(["lessonMedia"]);
  });

  // Sem aula exigida, a comunidade desligada deixaria publicar um produto vazio.
  it("comunidade: a comunidade precisa estar ligada", () => {
    const readiness = getCourseReadiness({ ...empty, productFormat: "community", communityEnabled: false });
    expect(readiness.pending.map((item) => item.id)).toEqual(["community"]);
  });

  it("evento ao vivo: a sessao agendada no lugar da aula", () => {
    const base = { ...empty, productFormat: "live_event" as const };
    expect(getCourseReadiness({ ...base, scheduledSessionCount: 0 }).pending.map((item) => item.id)).toEqual(["session"]);
    expect(getCourseReadiness({ ...base, scheduledSessionCount: 1 }).ready).toBe(true);
    // Sem a lista de sessoes (Manage), o item some, como lessonMedia.
    expect(ids(base)).not.toContain("session");
  });

  it("e-book: ao menos um arquivo, sem cobrar modulo, aula nem conteudo de aula", () => {
    const base = {
      ...complete,
      paymentType: "free" as const,
      priceAmountMinor: 0,
      productFormat: "ebook" as const,
      lessonIdsWithMedia: new Set<string>(),
    };
    expect(getCourseReadiness({ ...base, lessonFileCount: 0 }).pending.map((item) => item.id)).toEqual(["file"]);
    expect(getCourseReadiness({ ...base, lessonFileCount: 1 }).ready).toBe(true);
  });

  it("so conta arquivo preso a uma aula do produto", () => {
    const modules = [{ id: "m1", title: "Download", lessons: [lesson] }];
    const assets: Pick<CourseAsset, "kind" | "lessonId">[] = [
      { kind: "lesson_material", lessonId: "l1" },
      { kind: "lesson_material", lessonId: "deleted-lesson" },
      { kind: "lesson_material", lessonId: null },
      { kind: "lesson_video", lessonId: "l1" },
    ];
    expect(countLessonFiles(modules, assets)).toBe(1);
  });

  it("traduz os itens novos", () => {
    const es = (key: string) => translate(getDictionary("es"), key);
    const session = getCourseReadiness({ ...empty, productFormat: "live_event", scheduledSessionCount: 0 }, undefined, es)
      .items.find((item) => item.id === "session");
    const file = getCourseReadiness({ ...empty, productFormat: "ebook", lessonFileCount: 0 }, undefined, es)
      .items.find((item) => item.id === "file");
    const community = getCourseReadiness({ ...empty, productFormat: "community" }, undefined, es)
      .items.find((item) => item.id === "community");
    expect([session?.label, file?.label, community?.label])
      .toEqual(["Sesión en vivo", "Archivo para descargar", "Comunidad activada"]);
  });
});

// Cada tipo aceita so as suas formas de pagar (paymentTypeFitsFormat, o
// espelho de course_payment_type_fits_format). Produto criado antes da regra
// mostra o item de preco aberto, com o motivo, em vez de publicar e o banco
// recusar.
describe("forma de pagar que o tipo nao aceita", () => {
  const pricing = (input: CourseReadinessInput, t?: (key: string) => string) =>
    getCourseReadiness(input, undefined, t).items.find((item) => item.id === "pricing");

  it.each([
    ["community", "one_time"],
    ["live_event", "subscription_monthly"],
    ["ebook", "subscription_yearly"],
  ] as const)("%s cobrando %s: o preco fica pendente", (productFormat, paymentType) => {
    const item = pricing({ ...complete, productFormat, paymentType, communityEnabled: true });
    expect(item?.done).toBe(false);
    expect(item?.hint).toBe("This way of paying does not fit this type of product. Pick another one in Pricing.");
    const es = pricing({ ...complete, productFormat, paymentType, communityEnabled: true }, (key) =>
      translate(getDictionary("es"), key),
    );
    expect(es?.hint).toBe("Esta forma de pago no corresponde a este tipo de producto. Elige otra en Precios.");
  });

  it.each([
    ["course", "subscription_yearly"],
    ["community", "subscription_yearly"],
    ["live_event", "one_time"],
    ["ebook", "one_time"],
  ] as const)("%s cobrando %s: o preco conta como feito", (productFormat, paymentType) => {
    expect(pricing({ ...complete, productFormat, paymentType, communityEnabled: true })?.done).toBe(true);
  });

  // "$0" fixo dizia dolar para quem vende em real.
  it("o zero da dica vem na moeda escolhida", () => {
    const empty = { ...complete, priceAmountMinor: null, currency: "BRL" };
    expect(pricing(empty)?.hint).toBe("Set a price above R$0, or choose Free.");
    expect(pricing(empty, (key) => translate(getDictionary("es"), key))?.hint).toBe(
      "Define un precio mayor que R$0 o elige Gratis.",
    );
    expect(pricing({ ...empty, currency: "USD" })?.hint).toBe("Set a price above $0, or choose Free.");
  });
});
