import {
  countCourseLessons,
  normalizeCourseCategories,
  type TeacherCourse,
} from "@/domain/teacher-course";

// O que a pessoa sofria: o construtor tinha DUAS listas de "o que falta para
// publicar" (aba Publish e rodape) e o Manage uma TERCEIRA, cada uma com regra
// propria. Para o mesmo curso o chip dizia 71%, a barra do mesmo cabecalho
// media estagios (40%) e o Manage, que exigia payouts, mostrava 50%. Aqui fica
// a regra unica, a mais exigente das tres, e toda tela le daqui.

export type CourseReadinessInput = Pick<
  TeacherCourse,
  | "title"
  | "summary"
  | "category"
  | "categories"
  | "modules"
  | "priceAmountMinor"
  | "paymentType"
  | "installmentsEnabled"
  | "installmentsMax"
  | "coverImageUrl"
  | "learningOutcomes"
>;

// Travas que nao sao do curso, sao do professor. So o Manage as conhecia; o
// construtor deixava a pessoa clicar em Publish e descobrir pelo erro do
// servidor. Opcional para quem nao tem o perfil carregado (ex.: testes puros).
export type CourseReadinessAccount = {
  payoutsReady: boolean;
  verificationRequired: boolean;
  verificationApproved: boolean;
};

export type CourseReadinessItemId =
  | "title"
  | "summary"
  | "category"
  | "cover"
  | "module"
  | "lesson"
  | "pricing"
  | "installments"
  | "outcomes"
  | "payouts"
  | "verification";

// Os tres estados que a Hotmart separa e a barra "N de M" misturava:
// conteudo salvo (o que o aluno assiste), pagina preparada (o que o comprador
// le) e venda disponivel (o que o dinheiro exige). So agrupamento e rotulo;
// nada aqui segura a publicacao.
export type CourseReadinessGroupId = "content" | "page" | "sale";

export type CourseReadinessItem = {
  id: CourseReadinessItemId;
  group: CourseReadinessGroupId;
  label: string;
  // Presentation can be localized; callers without a translator keep English.
  hint: string;
  done: boolean;
  // Opcional nao entra na porcentagem nem trava o publish.
  optional: boolean;
};

export type CourseReadiness = {
  items: CourseReadinessItem[];
  // Obrigatorios ainda abertos, na ordem em que a pessoa deve resolver.
  pending: CourseReadinessItem[];
  next: CourseReadinessItem | null;
  doneCount: number;
  total: number;
  percent: number;
  ready: boolean;
};

export function getCourseReadiness(
  course: CourseReadinessInput,
  account?: CourseReadinessAccount,
  t?: (key: string) => string,
): CourseReadiness {
  // Curso antigo pode nao ter paymentType gravado; o construtor sempre leu
  // preco 0 como Free e o resto como venda avulsa. Mesma leitura aqui.
  const paymentType =
    course.paymentType ?? (course.priceAmountMinor === 0 ? "free" : "one_time");
  const priceAmountMinor = course.priceAmountMinor ?? 0;
  const modules = course.modules ?? [];
  const paid = paymentType !== "free" && priceAmountMinor > 0;

  const items: CourseReadinessItem[] = [
    {
      id: "title",
      group: "content",
      label: "Course title",
      // 3 caracteres e o minimo do formulario de criacao e do Manage; o
      // construtor aceitava qualquer caractere. Vale o mais exigente.
      hint: "Give the course a title (3+ characters).",
      done: course.title.trim().length >= 3,
      optional: false,
    },
    {
      id: "summary",
      group: "page",
      label: "Summary",
      hint: "Write a summary with at least 20 characters.",
      done: course.summary.trim().length >= 20,
      optional: false,
    },
    {
      id: "category",
      group: "page",
      label: "Marketplace category",
      hint: "Choose at least one marketplace category.",
      done:
        normalizeCourseCategories([...(course.categories ?? []), course.category])
          .length > 0,
      optional: false,
    },
    {
      id: "cover",
      group: "page",
      label: "Cover image",
      hint: "Upload a cover — it fronts the product page and marketplace cards.",
      done: Boolean(course.coverImageUrl),
      optional: true,
    },
    {
      id: "module",
      group: "content",
      label: "Module",
      hint: "Add at least one module.",
      done: modules.length > 0,
      optional: false,
    },
    {
      id: "lesson",
      group: "content",
      label: "Lesson",
      hint: "Add at least one lesson.",
      done: countCourseLessons(modules) > 0,
      optional: false,
    },
    {
      id: "pricing",
      group: "sale",
      label: "Pricing",
      hint: "Set a paid price greater than $0, or choose Free.",
      done: paymentType === "free" || priceAmountMinor > 0,
      optional: false,
    },
    {
      id: "outcomes",
      group: "page",
      label: "Learning outcomes",
      hint: "Add learning outcomes — they lift conversion on the product page.",
      done: (course.learningOutcomes?.length ?? 0) > 0,
      optional: true,
    },
  ];

  // Parcelamento so existe na venda avulsa com a opcao ligada. Listar o item
  // sempre (como o construtor fazia) dava um "feito" de graca e inflava a
  // porcentagem de um curso vazio.
  if (paymentType === "one_time" && course.installmentsEnabled) {
    items.push({
      id: "installments",
      group: "sale",
      label: "Installments",
      hint: "Set a valid installment limit.",
      done:
        typeof course.installmentsMax === "number" && course.installmentsMax >= 1,
      optional: false,
    });
  }

  if (account) {
    if (paid) {
      items.push({
        id: "payouts",
        group: "sale",
        label: "Stripe payouts",
        hint: "Finish Stripe payout onboarding before publishing a paid course.",
        done: account.payoutsReady,
        optional: false,
      });
    }
    items.push({
      id: "verification",
      group: "sale",
      label: "Professional verification",
      hint: account.verificationRequired
        ? "Complete professional verification before publishing."
        : "Optional today — becomes required when professional admission opens.",
      done: account.verificationApproved,
      optional: !account.verificationRequired,
    });
  }

  if (t) {
    for (const item of items) {
      item.label = t(`creatorEditor.readiness.items.${item.id}.label`);
      item.hint = t(`creatorEditor.readiness.items.${item.id}.${
        item.id === "verification" && item.optional ? "optionalHint" : "hint"
      }`);
    }
  }

  const required = items.filter((item) => !item.optional);
  const pending = required.filter((item) => !item.done);
  const doneCount = required.length - pending.length;

  return {
    items,
    pending,
    next: pending[0] ?? null,
    doneCount,
    total: required.length,
    percent: required.length
      ? Math.round((doneCount / required.length) * 100)
      : 0,
    ready: pending.length === 0,
  };
}

export type CourseReadinessGroup = {
  id: CourseReadinessGroupId;
  items: CourseReadinessItem[];
  // Mesma conta de `doneCount`/`total`: so obrigatorios. Opcionais aparecem
  // na lista do grupo e ficam fora do numero, como ja ficavam do geral.
  doneCount: number;
  total: number;
  ready: boolean;
};

export const COURSE_READINESS_GROUP_IDS: readonly CourseReadinessGroupId[] = [
  "content",
  "page",
  "sale",
];

// Recorte puro sobre a lista ja calculada: nao muda `ready`, `percent` nem
// ids. Um grupo sem obrigatorio (ex.: venda de curso gratis sem conta) conta
// como pronto, e a soma dos tres `doneCount`/`total` bate com o geral.
export function groupCourseReadiness(
  readiness: Pick<CourseReadiness, "items">,
): CourseReadinessGroup[] {
  return COURSE_READINESS_GROUP_IDS.map((id) => {
    const items = readiness.items.filter((item) => item.group === id);
    const required = items.filter((item) => !item.optional);
    const doneCount = required.filter((item) => item.done).length;
    return { id, items, doneCount, total: required.length, ready: doneCount === required.length };
  });
}
