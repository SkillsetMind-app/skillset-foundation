import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourse, updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

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
        coverAssetId: "cover-m2",
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

// Marcador do estudio da aula: o que importa aqui e PARA QUAL modulo e aula ele
// abre, nao o que faz por dentro (isso e lesson-content-modal.test.tsx).
vi.mock("@/components/teacher/lesson-content-modal", () => ({
  LessonContentModal: (props: {
    module: { id: string };
    lesson: { title: string };
    onClose: () => void;
  }) => (
    <div role="dialog">
      {`${props.module.id}:${props.lesson.title}`}
      <button type="button" onClick={props.onClose}>Close studio</button>
    </div>
  ),
}));

function openAt(query: string) {
  mocks.searchParams = new URLSearchParams(query);
}

function tree() {
  return (
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>
  );
}

async function renderBuilder() {
  render(tree());
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
    // Abrir o builder ja num modulo (link direto, recarga) nao rouba o foco.
    expect(document.activeElement).toBe(document.body);
  });

  it("renomear o modulo na pagina dele preserva descricao, capa e aulas no autosave", async () => {
    openAt("courseId=course-1&tab=content&module=m2");
    const card = await renderBuilder();
    within(card).getByRole("navigation", { name: "Breadcrumb" });

    fireEvent.change(within(card).getByRole("textbox", { name: "Module 2" }), {
      target: { value: "Deep work, renamed" },
    });
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1].modules?.[1]).toEqual(
      expect.objectContaining({
        id: "m2",
        title: "Deep work, renamed",
        summary: "Protect the hours that matter.",
        coverAssetId: "cover-m2",
        lessons: [expect.objectContaining({ id: "l1", title: "Focus blocks", type: "video" })],
      }),
    );
  }, 10000);

  // Bug de dado: todo snapshot (inclusive o eco do nosso autosave) voltava o
  // modulo da aula para o 1o. Com o formulario ainda aberto no m2, a segunda
  // aula ia gravada no m1, e o estudio e o upload de video iam junto.
  it("a aula adicionada depois do eco do autosave fica no modulo aberto", async () => {
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return () => undefined;
    });
    openAt("courseId=course-1&tab=content&module=m2");
    const card = await renderBuilder();
    const form = () => card.querySelector("form") as HTMLElement;

    fireEvent.click(within(card).getByRole("button", { name: "Add lesson to module 2" }));
    fireEvent.change(within(form()).getByRole("textbox", { name: "Lesson title" }), {
      target: { value: "Lesson A" },
    });
    fireEvent.click(within(form()).getByRole("button", { name: "Add lesson" }));
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const first = vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1];
    act(() => emitCourse({ ...mocks.course, ...first }));
    expect(screen.getByRole("dialog")).toHaveTextContent("m2:Lesson A");
    fireEvent.click(screen.getByRole("button", { name: "Close studio" }));

    // Mesma pagina, mesmo formulario aberto, depois do eco.
    fireEvent.change(within(form()).getByRole("textbox", { name: "Lesson title" }), {
      target: { value: "Lesson B" },
    });
    fireEvent.click(within(form()).getByRole("button", { name: "Add lesson" }));
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(2), { timeout: 5000 });
    const second = vi.mocked(updateTeacherCourseBuilder).mock.calls[1][1];
    expect(second.modules?.[0].lessons).toEqual([]);
    expect(second.modules?.[1].lessons.map((lesson) => lesson.title)).toEqual([
      "Focus blocks",
      "Lesson A",
      "Lesson B",
    ]);
    act(() => emitCourse({ ...mocks.course, ...second }));
    expect(screen.getByRole("dialog")).toHaveTextContent("m2:Lesson B");
  }, 15000);

  it("abrir e voltar do modulo leva o foco ao titulo e depois a linha de onde saiu", async () => {
    const { rerender } = render(tree());
    await screen.findByRole("heading", { name: mocks.course.title });
    const card = () => document.querySelector("#builder-sec-modules") as HTMLElement;

    fireEvent.click(within(card()).getByRole("link", { name: /Deep work/ }));
    openAt("courseId=course-1&tab=content&module=m2");
    rerender(tree());
    expect(document.activeElement).toBe(within(card()).getByRole("heading", { name: "Deep work" }));

    fireEvent.click(within(card()).getByRole("link", { name: mocks.course.title }));
    openAt("courseId=course-1&tab=content");
    rerender(tree());
    expect(document.activeElement).toBe(within(card()).getByRole("link", { name: /Deep work/ }));
  });

  // Perda de conteudo: o snapshot do realtime (eco de um save ANTERIOR)
  // sobrescrevia o rascunho local com edicao ainda nao gravada, e o autosave
  // nunca a regravava. A aula sumia da tela e o estudio nunca abria.
  it("eco de um save anterior nao apaga edicao local ainda nao gravada", async () => {
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return () => undefined;
    });
    let finishFirst = () => {};
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishFirst = resolve; }),
    );
    openAt("courseId=course-1&tab=content&module=m1");
    const card = await renderBuilder();

    // 1) Autosave de um titulo sai e fica no ar.
    fireEvent.change(within(card).getByRole("textbox", { name: "Module 1" }), {
      target: { value: "Start here, renamed" },
    });
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const first = vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1];

    // 2) Edicao nova enquanto ele esta no ar: uma aula.
    fireEvent.click(within(card).getByRole("button", { name: "Add lesson to module 1" }));
    const form = card.querySelector("form") as HTMLElement;
    fireEvent.change(within(form).getByRole("textbox", { name: "Lesson title" }), {
      target: { value: "Fresh lesson" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Add lesson" }));

    // 3) Chega o eco do 1o save (sem a aula) e depois o save volta.
    act(() => emitCourse({ ...mocks.course, ...first }));
    await act(async () => finishFirst());

    // A aula continua na tela, na pagina do modulo...
    expect(within(card).getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(within(card).getAllByRole("textbox", { name: "Lesson title" }).map((input) => (input as HTMLInputElement).value))
      .toContain("Fresh lesson");
    // ...e no autosave seguinte.
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(2), { timeout: 5000 });
    const second = vi.mocked(updateTeacherCourseBuilder).mock.calls[1][1];
    expect(second.modules?.[0]).toEqual(expect.objectContaining({
      title: "Start here, renamed",
      lessons: [expect.objectContaining({ title: "Fresh lesson" })],
    }));
    // O eco desse save confirma a aula e abre o estudio nela.
    act(() => emitCourse({ ...mocks.course, ...second }));
    expect(screen.getByRole("dialog")).toHaveTextContent("m1:Fresh lesson");
  }, 15000);

  // Ctrl/Cmd/Shift/Alt+clique ou botao do meio abrem outra aba: esta aba nao
  // navega, entao nao pode ficar pedido de foco para o proximo voltar/avancar.
  it("clique que abre outra aba nao deixa pedido de foco pendurado", async () => {
    const { rerender } = render(tree());
    await screen.findByRole("heading", { name: mocks.course.title });
    const card = () => document.querySelector("#builder-sec-modules") as HTMLElement;

    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      fireEvent.click(within(card()).getByRole("link", { name: /Deep work/ }), init);
    }
    // Depois, o voltar/avancar do navegador troca a URL sem clique nesta aba.
    openAt("courseId=course-1&tab=content&module=m2");
    rerender(tree());
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(within(card()).getByRole("link", { name: mocks.course.title }), { ctrlKey: true });
    openAt("courseId=course-1&tab=content");
    rerender(tree());
    expect(document.activeElement).toBe(document.body);
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
    const hold = () => new Promise<void>((resolve) => pending.push(resolve));
    // Once, nao mockImplementation: clearAllMocks nao desfaz implementacao, e
    // uma gravacao que nunca volta vazaria para os testes seguintes.
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(hold).mockImplementationOnce(hold);
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
