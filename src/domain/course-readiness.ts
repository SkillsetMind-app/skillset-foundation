import { activationFeeUsd } from "@/data/plans";
import { isVideoAssetKind, type CourseAsset } from "@/domain/course-asset";
import { getSafeExternalUrl } from "@/domain/external-url";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import {
  countCourseLessons,
  normalizeCourseCategories,
  type TeacherCourse,
  type TeacherCourseModule,
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
  | "productFormat"
> & {
  // Aulas com conteudo (ver getLessonIdsWithMedia). Quem nao tem a lista de
  // arquivos (o Manage) nao passa: o item some e a porcentagem nao muda.
  lessonIdsWithMedia?: ReadonlySet<string>;
  // Evento ao vivo: sessoes agendadas em course_events. E-book: arquivos numa
  // aula do produto (countLessonFiles). Mesma regra de quem nao sabe: o item some.
  scheduledSessionCount?: number;
  lessonFileCount?: number;
};

// Aula com conteudo. A MESMA regra do aviso "aulas sem conteudo" do painel
// (getCourseMaintenanceIssues, que chama esta funcao) e do selo Done do estudio:
// - video enviado;
// - link: o do YouTube/Vimeo toca na aula, e um link antigo (Drive etc.) vira o
//   botao "Open resource" do aluno, entao tambem conta;
// - texto da aula ou a descricao antiga (aula de texto legada);
// - ao menos um arquivo de material: uma aula so com PDF e uma aula valida.
// Sem isso, um curso podia ser publicado e vendido com aulas vazias.
export function getLessonIdsWithMedia(
  modules: Pick<TeacherCourseModule, "lessons">[],
  assets: Pick<CourseAsset, "kind" | "lessonId">[],
): Set<string> {
  const ids = new Set<string>();
  for (const asset of assets) {
    if (asset.lessonId && (isVideoAssetKind(asset.kind) || asset.kind === "lesson_material")) {
      ids.add(asset.lessonId);
    }
  }
  for (const courseModule of modules) {
    for (const lesson of courseModule.lessons) {
      if (
        getTrustedLessonEmbed(lesson.externalUrl)
        || getSafeExternalUrl(lesson.externalUrl)
        || lesson.contentText?.trim()
        || lesson.description?.trim()
      ) {
        ids.add(lesson.id);
      }
    }
  }
  return ids;
}

// Arquivos (lesson_material) presos a uma aula do produto: e la que o comprador
// baixa. Arquivo de aula apagada nao conta. Mesma regra de publish_teacher_course.
export function countLessonFiles(
  modules: Pick<TeacherCourseModule, "lessons">[],
  assets: Pick<CourseAsset, "kind" | "lessonId">[],
): number {
  const lessonIds = new Set(modules.flatMap((courseModule) => courseModule.lessons.map((lesson) => lesson.id)));
  return assets.filter(
    (asset) => asset.kind === "lesson_material" && asset.lessonId !== null && lessonIds.has(asset.lessonId),
  ).length;
}

// Travas que nao sao do curso, sao do professor. So o Manage as conhecia; o
// construtor deixava a pessoa clicar em Publish e descobrir pelo erro do
// servidor. Opcional para quem nao tem o perfil carregado (ex.: testes puros).
export type CourseReadinessAccount = {
  payoutsReady: boolean;
  verificationRequired: boolean;
  verificationApproved: boolean;
  // A taxa unica so aparecia como erro do banco depois do clique em Publish.
  // Vem do mesmo predicado do gatilho (creator_activation_blocked).
  activationBlocked?: boolean;
};

export type CourseReadinessItemId =
  | "title"
  | "summary"
  | "category"
  | "cover"
  | "module"
  | "lesson"
  | "lessonMedia"
  | "session"
  | "file"
  | "pricing"
  | "installments"
  | "outcomes"
  | "payouts"
  | "verification"
  | "activation";

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
  // O que cada tipo precisa entregar. Curso: modulo e aula. Comunidade: nada
  // (aulas opcionais). Evento ao vivo: a sessao. E-book: um arquivo.
  const productFormat = course.productFormat ?? "course";
  const paid = paymentType !== "free" && priceAmountMinor > 0;
  const lessons = modules.flatMap((courseModule) => courseModule.lessons);
  const withMedia = course.lessonIdsWithMedia;
  const lessonsWithoutMedia = withMedia ? lessons.filter((lesson) => !withMedia.has(lesson.id)) : [];
  // As tres primeiras aulas vazias, pelo titulo que o professor deu, e quantas
  // mais faltam ("e N mais", como o aviso do painel; nada de "…" antes do ponto).
  const missingLessonsText = (untitled: string, one: string, more: string) => {
    const names = lessonsWithoutMedia.slice(0, 3).map((lesson) => lesson.title.trim() || untitled).join(", ");
    const extra = lessonsWithoutMedia.length - 3;
    return (extra > 0 ? more : one)
      .replace("{count}", () => String(extra))
      .replace("{lessons}", () => names);
  };

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
      // "Description" em toda tela: criacao, construtor e checklist. A chave
      // continua `summary`.
      label: "Description",
      hint: "Write a description with at least 20 characters.",
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
    ...(productFormat === "course"
      ? [
          {
            id: "module" as const,
            group: "content" as const,
            label: "Module",
            hint: "Add at least one module.",
            done: modules.length > 0,
            optional: false,
          },
          {
            id: "lesson" as const,
            group: "content" as const,
            label: "Lesson",
            hint: "Add at least one lesson.",
            done: countCourseLessons(modules) > 0,
            optional: false,
          },
        ]
      : []),
    ...(productFormat === "live_event" && course.scheduledSessionCount !== undefined
      ? [{
          id: "session" as const,
          group: "content" as const,
          label: "Live session",
          hint: "Schedule the date and time of the live session.",
          done: course.scheduledSessionCount > 0,
          optional: false,
        }]
      : []),
    ...(productFormat === "ebook" && course.lessonFileCount !== undefined
      ? [{
          id: "file" as const,
          group: "content" as const,
          label: "File to download",
          hint: "Upload at least one file: PDF, slides or workbook.",
          done: course.lessonFileCount > 0,
          optional: false,
        }]
      : []),
    // So com a lista de aulas com conteudo e ao menos uma aula: sem aula, o
    // item "lesson" ja cobra, e listar este daria um "feito" de graca. No
    // e-book a aula nao aparece na tela; o item "file" cobra o mesmo arquivo.
    ...(withMedia && lessons.length > 0 && productFormat !== "ebook"
      ? [{
          id: "lessonMedia" as const,
          group: "content" as const,
          label: "Lesson content",
          hint: lessonsWithoutMedia.length
            ? `Add a video, text or file to every lesson. ${missingLessonsText(
                "Untitled lesson",
                "Missing: {lessons}.",
                "Missing: {lessons} and {count} more.",
              )}`
            : "Add a video, text or file to every lesson.",
          done: lessonsWithoutMedia.length === 0,
          optional: false,
        }]
      : []),
    // Produto gratis nao tem preco a definir: listar "Pricing" como feito so
    // fazia quem escolheu Gratis ler "Set a paid price" no checklist.
    ...(paymentType === "free"
      ? []
      : [{
          id: "pricing" as const,
          group: "sale" as const,
          label: "Pricing",
          hint: "Set a paid price greater than $0, or choose Free.",
          done: priceAmountMinor > 0,
          optional: false,
        }]),
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
    if (account.activationBlocked) {
      items.push({
        id: "activation",
        group: "sale",
        label: `Activation — US$${activationFeeUsd}, one time`,
        hint: "Charged once per creator account, never per course. Paying unlocks publishing.",
        done: false,
        optional: false,
      });
    }
  }

  if (t) {
    for (const item of items) {
      item.label = t(`creatorEditor.readiness.items.${item.id}.label`);
      item.hint = t(`creatorEditor.readiness.items.${item.id}.${
        item.id === "verification" && item.optional ? "optionalHint" : "hint"
      }`);
      if (item.id === "activation") {
        item.label = item.label.replace("{amount}", () => String(activationFeeUsd));
      }
      if (item.id === "lessonMedia" && !item.done) {
        item.hint += ` ${missingLessonsText(
          t("creatorEditor.lesson.untitled"),
          t("creatorEditor.readiness.items.lessonMedia.missing"),
          t("creatorEditor.readiness.items.lessonMedia.missingMore"),
        )}`;
      }
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
