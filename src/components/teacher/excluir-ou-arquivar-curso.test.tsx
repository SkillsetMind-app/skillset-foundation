import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import { TeacherCourseStudio } from "@/components/teacher/teacher-course-studio";
import type { TeacherCourse } from "@/domain/teacher-course";

// O que a pessoa sofria: o professor so conseguia apagar RASCUNHO, e so pelo ⋮
// da lista. No hub do produto — a tela onde ele passa o dia — nao havia acao
// nenhuma, e um curso publicado so saia do ar se um admin despublicasse.
//
// Estas provas cobrem a entrada nova (o menu no cabecalho do hub, no mesmo
// lugar do caret da Hotmart), o modal que troca de texto conforme o curso tem
// ou nao comprador, e os dois destinos que o servidor devolve.

const mocks = vi.hoisted(() => {
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Facilitation foundations",
    summary: "Build a dependable practice for leading productive group sessions.",
    category: "Facilitation & Group Work",
    categories: ["Facilitation & Group Work"],
    status: "published",
    modules: [{ id: "m1", title: "Start here", lessons: [] }],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    course,
    // O MESMO objeto em todo render: um usuario novo por render reinscreve os
    // efeitos e entra em laco.
    user: { uid: "teacher-1", displayName: "Patricia", roles: ["teacher"] },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams(),
    deleteOrArchiveCourse: vi.fn(),
    getCourseAudience: vi.fn(),
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
  deleteOrArchiveCourse: mocks.deleteOrArchiveCourse,
  getCourseAudience: mocks.getCourseAudience,
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

function renderEn(ui: ReactElement) {
  return render(<I18nProvider initialLocale="en">{ui}</I18nProvider>);
}

const MENU_TRIGGER = "More actions for Facilitation foundations";

async function abreMenuDoHub() {
  renderEn(<CourseManageHub courseId="course-1" />);
  const trigger = await screen.findByRole("button", { name: MENU_TRIGGER });
  fireEvent.click(trigger);
  return screen.getByRole("menu", { name: "Actions for Facilitation foundations" });
}

async function abreModalDoHub() {
  const menu = await abreMenuDoHub();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete course" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete Facilitation foundations" });
  // O modal so libera a confirmacao depois de saber quantos compradores existem.
  await waitFor(() => expect(mocks.getCourseAudience).toHaveBeenCalledWith("course-1"));
  return dialog;
}

beforeEach(() => {
  mocks.course.status = "published";
  mocks.router.push.mockReset();
  mocks.deleteOrArchiveCourse.mockReset();
  mocks.deleteOrArchiveCourse.mockResolvedValue({ outcome: "deleted" });
  mocks.getCourseAudience.mockReset();
  mocks.getCourseAudience.mockResolvedValue({ enrollments: 0, orders: 0 });
});

afterEach(cleanup);

describe("hub do curso — entrada de excluir/arquivar", () => {
  // A Hotmart poe a acao no caret ao lado de "Trocar Produto". Aqui ela fica no
  // mesmo lugar: ao lado do seletor de produto e do "Edit in Builder".
  it("oferece novo produto, prévia e excluir, nessa ordem, no cabeçalho", async () => {
    const menu = await abreMenuDoHub();
    const itens = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);

    expect(itens).toEqual(["New product", "Preview as a student", "Delete course"]);
    expect(within(menu).getByRole("menuitem", { name: "New product" })).toHaveAttribute(
      "href",
      "/teach/builder?newCourse=1&format=course",
    );
    expect(
      within(menu).getByRole("menuitem", { name: "Preview as a student" }),
    ).toHaveAttribute("href", "/teach/builder/course-1/preview");
  });

  // O ⋮ da lista chamava `delete_teacher_course_draft` e sumia fora de
  // rascunho. Agora ele abre o MESMO modal, para um curso publicado inclusive.
  it("a lista de produtos abre a mesma ação, mesmo com o curso publicado", async () => {
    renderEn(<TeacherCourseStudio />);
    fireEvent.click(await screen.findByRole("button", { name: MENU_TRIGGER }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    await screen.findByRole("dialog", { name: "Delete Facilitation foundations" });
    await waitFor(() => expect(mocks.getCourseAudience).toHaveBeenCalledWith("course-1"));
  });
});

describe("modal de excluir/arquivar — o texto segue o dado", () => {
  it("sem comprador, avisa que a exclusão é permanente", async () => {
    const dialog = await abreModalDoHub();

    expect(within(dialog).getByText("Delete this course?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "This permanently deletes the course and all its content. It can't be undone.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Yes, delete" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Archive course" })).toBeNull();
  });

  it("com comprador, promete arquivar e manter o acesso de quem pagou", async () => {
    mocks.getCourseAudience.mockResolvedValue({ enrollments: 3, orders: 3 });
    const dialog = await abreModalDoHub();

    await within(dialog).findByText("This course has students");
    expect(
      within(dialog).getByText(/it will be archived: it leaves the store/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Students who already bought this course keep their access exactly as it is today.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Archive course" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Yes, delete" })).toBeNull();
  });
});

describe("o que acontece depois da ação", () => {
  it("apagado, o hub sai de cena e volta para a lista", async () => {
    const dialog = await abreModalDoHub();
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(mocks.deleteOrArchiveCourse).toHaveBeenCalledWith("course-1"));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach/builder"));
  });

  it("arquivado, o hub continua de pé e mostra como republicar", async () => {
    mocks.course.status = "inactive";
    mocks.getCourseAudience.mockResolvedValue({ enrollments: 3, orders: 3 });
    mocks.deleteOrArchiveCourse.mockResolvedValue({
      outcome: "archived",
      enrollments: 3,
      orders: 3,
    });

    const dialog = await abreModalDoHub();
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive course" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.router.push).not.toHaveBeenCalledWith("/teach/builder");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Facilitation foundations",
    );
    expect(screen.getByRole("link", { name: "Publish again" })).toBeInTheDocument();
  });
});
