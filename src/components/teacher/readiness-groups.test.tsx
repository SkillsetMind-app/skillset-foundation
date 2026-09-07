import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import type { TeacherCourse } from "@/domain/teacher-course";
import { publishTeacherCourse, subscribeToTeacherCourse } from "@/lib/data/teacher-courses";

// Mocks copiados de course-readiness-screens.test.tsx: o MESMO usuario e o
// MESMO curso em todo render. Um objeto novo por render reinscreve os
// efeitos, entra em laco e trava a maquina.
const mocks = vi.hoisted(() => {
  const subscriptionCounts = new Map<string, number>();
  function fused<A extends unknown[]>(name: string, impl: (...args: A) => () => void) {
    return (...args: A) => {
      const calls = (subscriptionCounts.get(name) ?? 0) + 1;
      subscriptionCounts.set(name, calls);
      if (calls > 20) {
        throw new Error(`${name} inscrito ${calls} vezes: laco de render`);
      }
      return impl(...args);
    };
  }

  // Titulo, resumo, categoria e um modulo prontos; sem aula e sem preco.
  // Conteudo 2 de 3 · pagina 2 de 2 (capa e resultados sao opcionais) ·
  // venda 0 de 1 (verificacao nao exigida e opcional; gratis nao pede repasse).
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [{ id: "m1", title: "Start here", lessons: [] }],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    fused,
    resetSubscriptionCounts: () => subscriptionCounts.clear(),
    course,
    user: { uid: "teacher-1" },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams("courseId=course-1&tab=review"),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: vi.fn(mocks.fused(
    "subscribeToTeacherCourse",
    (_id: string, onData: (course: TeacherCourse) => void) => {
      onData(mocks.course);
      return () => undefined;
    },
  )),
  subscribeToTeacherCourses: mocks.fused(
    "subscribeToTeacherCourses",
    (_uid: string, onData: (courses: TeacherCourse[]) => void) => {
      onData([mocks.course]);
      return () => undefined;
    },
  ),
  publishTeacherCourse: vi.fn(),
  updateTeacherCourseBuilder: vi.fn(),
  setOwnCourseFeatured: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: mocks.fused(
    "subscribeToUserProfile",
    (_uid: string, onData: (profile: unknown) => void) => {
      onData({ creatorVerificationStatus: "none", currentPlanId: "free" });
      return () => undefined;
    },
  ),
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
}));

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: vi.fn(() => () => undefined),
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

vi.mock("@/components/teacher/course-asset-uploader", () => ({
  CourseAssetUploader: () => null,
}));

vi.mock("@/components/teacher/course-overview-panel", () => ({
  CourseOverviewPanel: () => null,
}));

// O titulo do grupo e um <p> com o nome num <span> e a contagem em texto
// solto; getByText so le os nos de texto diretos, entao a comparacao e pelo
// textContent inteiro do <p>.
function groupTitle(text: string) {
  return screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);
}

const copy = {
  en: {
    groups: ["Content saved · 2 of 3", "Page prepared · 2 of 2", "Sale available · 0 of 1"],
    banner: "This product is not published yet. Students only see it after you publish.",
    link: "Open the product panel",
  },
  es: {
    groups: ["Contenido guardado · 2 de 3", "Página preparada · 2 de 2", "Venta disponible · 0 de 1"],
    banner: "Este producto todavía no está publicado. Los estudiantes solo lo verán después de publicarlo.",
    link: "Abrir el panel del producto",
  },
} as const;

// A Hotmart separa conteudo salvo, pagina preparada e venda disponivel; a
// nossa barra somava os tres. E o editor dela avisa "esse produto nao esta
// publicado" enquanto e rascunho. Nada aqui segura a publicacao: e rotulo.
describe("checklist de publicacao em tres blocos e faixa de rascunho", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("section");
    mocks.searchParams.set("courseId", "course-1");
    mocks.searchParams.set("tab", "review");
  });

  it.each(["en", "es"] as const)("construtor em %s: tres titulos com contagem, faixa e link para o painel", async (locale) => {
    render(
      <I18nProvider initialLocale={locale}>
        <CourseBuilderStudio />
      </I18nProvider>,
    );
    await screen.findByRole("heading", { name: mocks.course.title });

    for (const title of copy[locale].groups) {
      expect(groupTitle(title)).toBeInTheDocument();
    }
    // Cada item continua na lista, dentro do seu bloco.
    const review = document.getElementById("builder-sec-review")!;
    expect(review.querySelector('[data-readiness-group="content"]')).toHaveTextContent(/Course title|Título del curso/);
    expect(review.querySelector('[data-readiness-group="content"]')).toHaveTextContent(/Lesson|Lección/);
    expect(review.querySelector('[data-readiness-group="page"]')).toHaveTextContent(/Cover image|Imagen de portada/);
    expect(review.querySelector('[data-readiness-group="sale"]')).toHaveTextContent(/Pricing|Precios/);

    const banner = screen.getByText(copy[locale].banner);
    expect(banner.closest('[role="status"]')).not.toBeNull();
    const link = screen.getByRole("link", { name: copy[locale].link });
    expect(link).toHaveAttribute("href", "/teach/courses/course-1/manage");
    expect(link.className).toContain("min-h-11");

    // Agrupar nao mexe na trava: o mesmo curso continua sem poder publicar.
    expect(screen.getByRole("button", { name: /Publish product|Publicar producto/ })).toBeDisabled();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("curso publicado: os blocos ficam, a faixa some", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, status: "published" });
      return () => {};
    });
    render(
      <I18nProvider initialLocale="en">
        <CourseBuilderStudio />
      </I18nProvider>,
    );
    await screen.findByRole("heading", { name: mocks.course.title });

    expect(groupTitle(copy.en.groups[0])).toBeInTheDocument();
    expect(screen.queryByText(copy.en.banner)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: copy.en.link })).not.toBeInTheDocument();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
  });

  it("painel do produto: a mesma lista em tres blocos, com o link de verificacao no bloco de venda", async () => {
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");

    const list = screen.getByText("Publish checklist").closest("section") ?? document.body;
    for (const title of copy.en.groups) {
      expect(within(list).getByText((_, el) => el?.tagName === "P" && el.textContent === title)).toBeInTheDocument();
    }
    const sale = list.querySelector<HTMLElement>('[data-readiness-group="sale"]')!;
    expect(within(sale).getByRole("link", { name: "Open verification" })).toHaveAttribute("href", "/teach/verification");
    expect(within(sale).getByText("Set a paid price greater than $0, or choose Free.")).toBeInTheDocument();
    expect(screen.getByTestId("publish-readiness-bar")).toHaveStyle({ width: "67%" });
  });
});
