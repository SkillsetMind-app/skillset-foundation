import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import { TeacherCourseStudio } from "@/components/teacher/teacher-course-studio";
import { TeacherStudioDashboard } from "@/components/teacher/teacher-studio-dashboard";
import type { TeacherCourse } from "@/domain/teacher-course";

// O que a pessoa sofria: com o idioma em espanhol, o painel do produto, a
// lista de produtos e a Home do criador seguiam em ingles. Estas provas
// renderizam as tres telas dentro do I18nProvider em "es" e conferem alguns
// rotulos por tela. O conteudo autoral (titulo do curso) fica como esta.

const mocks = vi.hoisted(() => {
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Fundamentos de facilitación",
    summary: "Una práctica repetible para conducir sesiones de grupo productivas.",
    category: "Facilitation & Group Work",
    categories: ["Facilitation & Group Work"],
    status: "draft",
    modules: [{ id: "m1", title: "Empieza aquí", lessons: [] }],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    course,
    // O MESMO objeto em todo render: um usuario novo por render reinscreve os
    // efeitos e entra em laco.
    user: { uid: "teacher-1", displayName: "Patricia Simón", roles: ["teacher"] },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/teach",
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, status: "authenticated" }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: (_id: string, onData: (course: TeacherCourse) => void) => {
    onData(mocks.course);
    return () => undefined;
  },
  subscribeToTeacherCourses: (_uid: string, onData: (courses: TeacherCourse[]) => void) => {
    onData([mocks.course]);
    return () => undefined;
  },
  deleteTeacherCourse: vi.fn(),
  setOwnCourseFeatured: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (profile: unknown) => void) => {
    onData({ creatorVerificationStatus: "none", currentPlanId: "free" });
    return () => undefined;
  },
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (_uid: string, onData: (orders: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/enrollments", () => ({
  getMyCourseStudents: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: () => () => undefined,
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

vi.mock("@/lib/data/course-commerce", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  subscribeToCourseCoupons: (_id: string, onData: (coupons: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-reviews", () => ({
  getRecentCourseReviews: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/community-posts", () => ({
  getRecentCommunityQuestions: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (_uid: string, onData: (entries: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock("@/components/teacher/teacher-overview-metrics", () => ({
  TeacherOverviewMetrics: () => null,
}));

vi.mock("@/components/teacher/teacher-studio-insights", () => ({
  TeacherStudioInsights: () => null,
}));

function renderEs(ui: ReactElement) {
  return render(<I18nProvider initialLocale="es">{ui}</I18nProvider>);
}

afterEach(cleanup);

describe("painel do criador em espanhol", () => {
  it("painel do produto: menu, lista de publicacao e destaque falam espanhol", async () => {
    renderEs(<CourseManageHub courseId="course-1" />);

    const menu = await screen.findByRole("navigation", {
      name: "Secciones de gestión del curso",
    });
    expect(within(menu).getByRole("button", { name: "Enlaces de promoción" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Precios y ofertas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mis productos" })).toHaveAttribute(
      "href",
      "/teach/builder",
    );
    expect(screen.getByRole("heading", { name: "Lista de publicación" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Destacar este curso" })).toBeInTheDocument();
    // Titulo do curso e conteudo autoral: fica como o professor escreveu.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Fundamentos de facilitación",
    );
  });

  it("como vai o produto: os numeros e o estado vazio falam espanhol", async () => {
    renderEs(<CourseManageHub courseId="course-1" />);

    expect(
      await screen.findByRole("heading", { name: "Cómo va este producto" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Todavía nadie ha comprado este producto."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver página pública" })).toHaveAttribute(
      "href",
      "/courses/course-1",
    );
    expect(screen.getByRole("link", { name: "Ver como alumno" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Revisar y publicar" }).length).toBeGreaterThan(0);
  });

  it("lista de produtos: cabecalho, colunas, acoes e filtros falam espanhol", async () => {
    renderEs(<TeacherCourseStudio />);

    const table = await screen.findByRole("table", { name: "Productos" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Mis productos");
    expect(screen.getByRole("link", { name: "Nuevo producto" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Producto" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Alumnos" })).toBeInTheDocument();
    expect(within(table).getByText("Pago único")).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Abrir" })).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "Más acciones para Fundamentos de facilitación" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Borradores" })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Atajos del espacio de productos" }),
    ).toBeInTheDocument();
  });

  it("home do criador: proximos passos, produtos, formatos e marcos falam espanhol", async () => {
    renderEs(<TeacherStudioDashboard />);

    const steps = await screen.findByRole("list", { name: "Próximos pasos del creador" });
    expect(
      screen.getByRole("heading", { name: "Prepárate para tu primera venta" }),
    ).toBeInTheDocument();
    expect(within(steps).getByText("Crea un producto")).toBeInTheDocument();
    expect(within(steps).getByText("Completa tus datos de creador")).toBeInTheDocument();
    expect(within(steps).getByText("Prepara el producto para vender")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Productos en tu espacio" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Borradores" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "En venta" })).toBeInTheDocument();
    // O card do produto tambem diz "Curso online"; a prova olha so a secao de formatos.
    const formats = screen
      .getByRole("heading", { name: "Elige un formato de producto" })
      .closest("section") as HTMLElement;
    expect(within(formats).getByRole("link", { name: /Curso online/ })).toHaveAttribute(
      "href",
      "/teach/builder?newCourse=1&format=course",
    );
    expect(within(formats).getByRole("link", { name: /Programa guiado/ })).toHaveAttribute(
      "href",
      "/teach/builder?newCourse=1&format=program",
    );
    expect(screen.getByRole("heading", { name: "Hitos del creador" })).toBeInTheDocument();
  });
});
