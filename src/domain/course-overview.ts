import { isVideoAssetKind, type CourseAsset } from "@/domain/course-asset";
import { isCouponExpired, type CourseCoupon } from "@/domain/course-commerce";
import {
  getCourseReadiness,
  type CourseReadinessAccount,
} from "@/domain/course-readiness";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import type { TeacherCourse } from "@/domain/teacher-course";

// O painel do produto respondia "quanto falta para publicar" e mais nada. Quem
// abre a tela de um produto JA publicado quer outra coisa: quantos alunos,
// quanto entrou, quantos terminaram, que nota tiraram — e o que esta quebrado
// agora. Aqui ficam as duas contas puras que a tela usa; nenhuma delas inventa
// numero, e a que nao tem fonte fica de fora em vez de virar zero.

export type CourseOverviewStudent = {
  courseId: string;
  status: string;
  progressPercent: number;
  enrolledAt: string;
};

export type CourseOverviewOrder = {
  courseId: string;
  status: string;
  currency: string;
  amountMinor: number;
  refundedAmountMinor?: number;
};

export type CourseRevenueTotal = {
  currency: string;
  netMinor: number;
};

export type CourseOverviewStats = {
  studentCount: number;
  completedCount: number;
  /** null quando ninguem esta matriculado: 0% seria uma medicao falsa. */
  completionPercent: number | null;
  averageProgressPercent: number | null;
  newThisWeekCount: number;
  paidOrderCount: number;
  /** Uma linha por moeda; pedidos em moedas diferentes nunca sao somados. */
  revenue: CourseRevenueTotal[];
  ratingAverage: number | null;
  ratingCount: number;
  /** Falso = produto sem nenhuma venda e nenhum aluno (estado vazio honesto). */
  hasHistory: boolean;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Terminou o curso. Mesma regra do certificado (`getCredentialCandidate`):
 * a matricula esta marcada como concluida OU o progresso chegou a 100.
 */
export function isCourseStudentComplete(student: {
  status: string;
  progressPercent: number;
}): boolean {
  return student.status === "completed" || student.progressPercent >= 100;
}

export function getCourseOverviewStats({
  course,
  students,
  orders,
  now = new Date(),
}: {
  course: Pick<TeacherCourse, "id" | "ratingAverage" | "ratingCount">;
  students: CourseOverviewStudent[];
  orders: CourseOverviewOrder[];
  now?: Date;
}): CourseOverviewStats {
  // Ambas as leituras trazem TODOS os cursos do professor (uma chamada serve
  // qualquer aba). O recorte por produto e aqui, num lugar so, para nenhuma
  // tela mostrar a receita da loja inteira como se fosse deste produto.
  const mine = students.filter((student) => student.courseId === course.id);
  const paidOrders = orders.filter(
    (order) => order.courseId === course.id && order.status === "paid",
  );

  const completedCount = mine.filter(isCourseStudentComplete).length;
  const cutoff = now.getTime() - WEEK_MS;
  const newThisWeekCount = mine.filter((student) => {
    const at = new Date(student.enrolledAt).getTime();
    return Number.isFinite(at) && at >= cutoff;
  }).length;

  const byCurrency = new Map<string, number>();
  for (const order of paidOrders) {
    const currency = (order.currency || "usd").toUpperCase();
    // Reembolso ja devolvido nao e receita. O pedido continua pago, entao
    // somar o bruto contaria dinheiro que voltou para o comprador.
    const net = order.amountMinor - (order.refundedAmountMinor ?? 0);
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + net);
  }

  const ratingCount = course.ratingCount ?? 0;

  return {
    studentCount: mine.length,
    completedCount,
    completionPercent: mine.length
      ? Math.round((completedCount / mine.length) * 100)
      : null,
    averageProgressPercent: mine.length
      ? Math.round(
          mine.reduce((sum, student) => sum + student.progressPercent, 0) / mine.length,
        )
      : null,
    newThisWeekCount,
    paidOrderCount: paidOrders.length,
    revenue: [...byCurrency.entries()]
      .map(([currency, netMinor]) => ({ currency, netMinor }))
      .sort((left, right) => right.netMinor - left.netMinor),
    ratingAverage: ratingCount ? (course.ratingAverage ?? null) : null,
    ratingCount,
    hasHistory: mine.length > 0 || paidOrders.length > 0,
  };
}

export type CourseMaintenanceIssue = {
  id: string;
  title: string;
  hint: string;
};

/**
 * O que esta quebrado NESTE produto agora.
 *
 * `assets` e `coupons` chegam como null enquanto a leitura nao voltou — a
 * regra que depende deles fica de fora nesse instante, porque acusar "aula sem
 * conteudo" so porque os assets ainda nao carregaram e pior que nao acusar.
 */
export function getCourseMaintenanceIssues({
  course,
  account,
  assets,
  coupons,
  now = new Date(),
}: {
  course: TeacherCourse;
  account?: CourseReadinessAccount;
  assets: CourseAsset[] | null;
  coupons: CourseCoupon[] | null;
  now?: Date;
}): CourseMaintenanceIssue[] {
  const issues: CourseMaintenanceIssue[] = [];

  if (assets) {
    const videoLessonIds = new Set(
      assets
        .filter((asset) => isVideoAssetKind(asset.kind) && asset.lessonId)
        .map((asset) => asset.lessonId as string),
    );

    // Mesma regra que o estudio da aula usa nos selos "Empty"/"Done": video
    // enviado, embed confiavel, texto da aula ou descricao. Nenhum dos quatro
    // = a pessoa que comprou abre a aula e nao encontra nada.
    const emptyLessons = course.modules.flatMap((courseModule) =>
      courseModule.lessons.filter(
        (lesson) =>
          !videoLessonIds.has(lesson.id) &&
          !getTrustedLessonEmbed(lesson.externalUrl) &&
          !(lesson.contentText ?? "").trim() &&
          !lesson.description.trim(),
      ),
    );

    if (emptyLessons.length) {
      const names = emptyLessons
        .slice(0, 3)
        .map((lesson) => lesson.title || "Untitled lesson")
        .join(", ");
      issues.push({
        id: "empty-lessons",
        title:
          emptyLessons.length === 1
            ? "1 lesson has no content"
            : `${emptyLessons.length} lessons have no content`,
        hint:
          emptyLessons.length > 3
            ? `${names} and ${emptyLessons.length - 3} more open with an empty page for the student. Add a video, an embed, or text.`
            : `${names} open with an empty page for the student. Add a video, an embed, or text.`,
      });
    }
  }

  if (coupons) {
    const expired = coupons.filter(
      (coupon) => coupon.active && isCouponExpired(coupon, now),
    );

    if (expired.length) {
      issues.push({
        id: "expired-coupons",
        title:
          expired.length === 1
            ? "1 active coupon is past its end date"
            : `${expired.length} active coupons are past their end date`,
        hint: `${expired
          .slice(0, 3)
          .map((coupon) => coupon.code)
          .join(", ")} still read as active on this product but no longer apply at checkout. Turn them off or extend the date.`,
      });
    }
  }

  // O resto sai da mesma lista de prontidao que a tela ja mostra — os itens
  // opcionais, que nunca travam a publicacao e por isso ficam esquecidos num
  // produto que ja esta no ar. `payouts` e `verification` ficam de fora: sao
  // pendencias da CONTA, valem para a loja inteira, e ja tem tela propria.
  for (const item of getCourseReadiness(course, account).items) {
    if (item.optional && !item.done && item.id !== "payouts" && item.id !== "verification") {
      issues.push({ id: `readiness-${item.id}`, title: item.label, hint: item.hint });
    }
  }

  return issues;
}
