import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { TeacherCourse } from "@/domain/teacher-course";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

// Fatia 4 do editor (decisao de 14/09): clicar num modulo abre a pagina dele
// DENTRO do builder (?module=M), com "Curso > Modulo", capa vertical 2:3, nome,
// descricao e as aulas. A lista do curso vira uma linha por modulo.

const mocks = vi.hoisted(() => {
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [
      { id: "m1", title: "Start here", lessons: [] },
      {
        id: "m2",
        title: "Deep work",
        summary: "Protect the hours that matter.",
        lessons: [{ id: "l1", title: "Focus blocks", type: "video", description: "" }],
      },
    ],
    lessonCount: 1,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    course,
    user: { uid: "teacher-1" },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams("courseId=course-1&tab=content"),
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
  subscribeToTeacherCourse: vi.fn((_id: string, onData: (course: TeacherCourse) => void) => {
    onData(mocks.course);
    return () => undefined;
  }),
  publishTeacherCourse: vi.fn(() => Promise.resolve()),
  updateTeacherCourseBuilder: vi.fn(() => Promise.resolve()),
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

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: vi.fn(() => () => undefined),
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

vi.mock("@/components/teacher/course-asset-uploader", () => ({
  CourseAssetUploader: () => null,
}));

function openAt(query: string) {
  mocks.searchParams = new URLSearchParams(query);
}

async function renderBuilder() {
  render(
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>,
  );
  await screen.findByRole("heading", { name: mocks.course.title });
  const card = document.querySelector("#builder-sec-modules");
  if (!card) throw new Error("a aba de conteudo nao abriu");
  return card as HTMLElement;
}

describe("pagina do modulo dentro do builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openAt("courseId=course-1&tab=content");
  });

  afterEach(() => {
    cleanup();
  });

  it("com ?module=M abre a pagina do modulo: titulo, trilha, capa 2:3 e as aulas", async () => {
    openAt("courseId=course-1&tab=content&module=m2");
    const card = await renderBuilder();

    expect(within(card).getByRole("heading", { name: "Deep work" })).toBeInTheDocument();
    const trail = within(card).getByRole("navigation", { name: "Breadcrumb" });
    expect(within(trail).getByRole("link", { name: mocks.course.title })).toHaveAttribute(
      "href",
      "/teach/builder?courseId=course-1&tab=content",
    );
    const cover = within(card).getByRole("region", { name: "Module cover" });
    expect(cover.querySelector(".aspect-\\[2\\/3\\]")).not.toBeNull();
    expect(within(card).getByRole("textbox", { name: "Module 2 description" })).toHaveValue(
      "Protect the hours that matter.",
    );

    // As acoes que ja existiam na aula continuam na pagina do modulo.
    expect(within(card).getByRole("textbox", { name: "Lesson title" })).toHaveValue("Focus blocks");
    for (const name of ["Add video", "Up", "Down", "Mark free preview", "Delete lesson"]) {
      expect(within(card).getByRole("button", { name })).toBeInTheDocument();
    }
    // So este modulo: o outro fica na lista do curso.
    expect(within(card).queryByText("Start here")).not.toBeInTheDocument();
  });

  it("sem ?module mostra uma linha por modulo, com nome em negrito e numero de aulas", async () => {
    const card = await renderBuilder();

    const rows = Array.from(card.querySelectorAll("article")) as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("link", { name: /Start here/ })).toHaveAttribute(
      "href",
      "/teach/builder?courseId=course-1&tab=content&module=m1",
    );
    expect(rows[1].querySelector("strong")).toHaveTextContent("Deep work");
    expect(within(rows[1]).getByText("1 lesson")).toBeInTheDocument();
    // A lista nao edita mais o nome no lugar: isso mora na pagina do modulo.
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(card).queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Add module" })).toBeInTheDocument();
  });

  it("id de modulo desconhecido ou apagado cai na lista, nao em tela vazia", async () => {
    openAt("courseId=course-1&tab=content&module=ghost");
    const card = await renderBuilder();

    expect(within(card).queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    expect(card.querySelectorAll("article")).toHaveLength(2);
    expect(within(card).getByRole("link", { name: /Deep work/ })).toBeInTheDocument();
  });

  it("o selo fica em Saving enquanto qualquer gravacao estiver pendente", async () => {
    const pending: Array<() => void> = [];
    vi.mocked(updateTeacherCourseBuilder).mockImplementation(
      () => new Promise<void>((resolve) => pending.push(resolve)),
    );
    openAt("courseId=course-1&tab=content&module=m1");
    const card = await renderBuilder();
    within(card).getByRole("navigation", { name: "Breadcrumb" });

    fireEvent.change(within(card).getByRole("textbox", { name: "Module 1" }), {
      target: { value: "Start here, renamed" },
    });
    // Autosave de verdade (debounce de 1,8 s) sai e fica pendente.
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(screen.getByText("Saving")).toBeInTheDocument();

    // O professor clica em Salvar com o autosave ainda no ar.
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(2);

    // A primeira volta; a segunda ainda nao. "Saved" aqui seria mentira.
    await act(async () => pending[0]());
    expect(screen.getByText("Saving")).toBeInTheDocument();
    expect(screen.queryByText("All changes saved")).not.toBeInTheDocument();

    await act(async () => pending[1]());
    expect(await screen.findByText("All changes saved")).toBeInTheDocument();
    expect(screen.queryByText("Saving")).not.toBeInTheDocument();
  }, 10000);
});
