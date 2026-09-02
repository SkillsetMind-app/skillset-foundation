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

export type CourseReadinessItem = {
  id: CourseReadinessItemId;
  label: string;
  // O que fazer quando pendente. Texto pronto para a tela, em ingles.
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
      label: "Course title",
      // 3 caracteres e o minimo do formulario de criacao e do Manage; o
      // construtor aceitava qualquer caractere. Vale o mais exigente.
      hint: "Give the course a title (3+ characters).",
      done: course.title.trim().length >= 3,
      optional: false,
    },
    {
      id: "summary",
      label: "Summary",
      hint: "Write a summary with at least 20 characters.",
      done: course.summary.trim().length >= 20,
      optional: false,
    },
    {
      id: "category",
      label: "Marketplace category",
      hint: "Choose at least one marketplace category.",
      done:
        normalizeCourseCategories([...(course.categories ?? []), course.category])
          .length > 0,
      optional: false,
    },
    {
      id: "cover",
      label: "Cover image",
      hint: "Upload a cover — it fronts the product page and marketplace cards.",
      done: Boolean(course.coverImageUrl),
      optional: true,
    },
    {
      id: "module",
      label: "Module",
      hint: "Add at least one module.",
      done: modules.length > 0,
      optional: false,
    },
    {
      id: "lesson",
      label: "Lesson",
      hint: "Add at least one lesson.",
      done: countCourseLessons(modules) > 0,
      optional: false,
    },
    {
      id: "pricing",
      label: "Pricing",
      hint: "Set a paid price greater than $0, or choose Free.",
      done: paymentType === "free" || priceAmountMinor > 0,
      optional: false,
    },
    {
      id: "outcomes",
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
        label: "Stripe payouts",
        hint: "Finish Stripe payout onboarding before publishing a paid course.",
        done: account.payoutsReady,
        optional: false,
      });
    }
    items.push({
      id: "verification",
      label: "Professional verification",
      hint: account.verificationRequired
        ? "Complete professional verification before publishing."
        : "Optional today — becomes required when professional admission opens.",
      done: account.verificationApproved,
      optional: !account.verificationRequired,
    });
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
