import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { DripStrategy } from "@/domain/drip-policy";
import type { TeacherCourse, TeacherLesson } from "@/domain/teacher-course";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

// Decisao do editor: mover a aula entre modulos, com alternativa de teclado,
// sem trocar o id (video, materiais, progresso e comentarios vao junto).

const mocks = vi.hoisted(() => ({
  course: null as TeacherCourse | null,
  user: { uid: "teacher-1" },
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams("courseId=course-1&tab=content"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: vi.fn((_id: string, onData: (course: TeacherCourse | null) => void) => {
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

vi.mock("@/components/teacher/course-asset-uploader", () => ({ CourseAssetUploader: () => null }));

// Marcador do estudio: importa PARA QUAL modulo e aula ele abre.
vi.mock("@/components/teacher/lesson-content-modal", () => ({
  LessonContentModal: (props: { module: { id: string }; lesson: { title: string } }) => (
    <div role="dialog">{`${props.module.id}:${props.lesson.title}`}</div>
  ),
}));

// Campos que sairam da tela tem de viajar junto: a RPC de troca total zera o
// que nao vier no payload.
function lesson(id: string, title: string): TeacherLesson {
  return {
    id,
    title,
    type: "video",
    description: "nota antiga",
    durationMinutes: 7,
    dripDelayDays: 3,
    contentText: "corpo",
    externalUrl: null,
  };
}

function courseWith(dripStrategy: DripStrategy = "instant"): TeacherCourse {
  return {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [
      { id: "m1", title: "Start here", lessons: [lesson("l1", "Welcome"), lesson("l2", "Second")] },
      { id: "m2", title: "Deep work", lessons: [lesson("l3", "Focus")] },
    ],
    lessonCount: 3,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
    freePreviewLessonId: "l2",
    dripStrategy,
  };
}

const positional: DripStrategy[] = ["sequential_progress", "time_drip_module", "time_drip_lesson"];
const confirmText =
  "Students who already opened this lesson may lose access until they reach it again in the new order. Move anyway?";

function tree() {
  return (
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>
  );
}

function openAt(query: string) {
  mocks.searchParams = new URLSearchParams(query);
}

async function renderBuilder() {
  const view = render(tree());
  await screen.findByRole("heading", { name: "Clinical performance foundations" });
  return view;
}

const card = () => document.querySelector("#builder-sec-modules") as HTMLElement;
const lastPayload = () => vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1];
const idsOf = (index: number) => lastPayload()?.modules?.[index].lessons.map((item) => item.id);
const titlesOnPage = () =>
  within(card()).getAllByRole("textbox", { name: "Lesson title" }).map((input) => (input as HTMLInputElement).value);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// DataTransfer de mentira: guarda o que foi posto e expoe os tipos, como o
// navegador faz no dragover (onde o conteudo ainda nao pode ser lido).
function fakeDataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    get types() {
      return Array.from(data.keys());
    },
    effectAllowed: "all",
    dropEffect: "move",
  };
}

function rowOf(moduleId: string) {
  return card().querySelector(`[data-module-row="${moduleId}"]`)?.closest("article") as HTMLElement;
}

function chooseAndMove(title: string, moduleId: string) {
  fireEvent.change(screen.getByRole("combobox", { name: `Move "${title}" to another module` }), {
    target: { value: moduleId },
  });
  fireEvent.click(screen.getByRole("button", { name: `Move "${title}"` }));
}

describe("mover a aula entre modulos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.course = courseWith();
    openAt("courseId=course-1&tab=content");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("o seletor e o botao Move levam L2 para o fim de M2 com o mesmo id, e o formulario e o estudio seguem no modulo certo", async () => {
    openAt("courseId=course-1&tab=content&module=m1");
    const { rerender } = await renderBuilder();

    chooseAndMove("Second", "m2");
    expect(titlesOnPage()).toEqual(["Welcome"]);
    // A linha saiu da pagina: foco no titulo do modulo e aviso do que mudou.
    expect(document.activeElement).toBe(within(card()).getByRole("heading", { name: "Start here" }));
    expect(within(card()).getByRole("status")).toHaveTextContent('"Second" moved to Deep work.');

    // O formulario da aula continua mirando o modulo aberto (M1).
    fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 1" }));
    const form = card().querySelector("form") as HTMLElement;
    fireEvent.change(within(form).getByRole("textbox", { name: "Lesson title" }), { target: { value: "Third" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add lesson" }));

    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(lastPayload()?.modules?.[0].lessons.map((item) => item.title)).toEqual(["Welcome", "Third"]);
    expect(idsOf(1)).toEqual(["l3", "l2"]);
    expect(lastPayload()?.modules?.[1].lessons[1]).toEqual(expect.objectContaining(lesson("l2", "Second")));
    expect(lastPayload()?.freePreviewLessonId).toBe("l2");

    // Na pagina de M2, o estudio de L2 abre mirando M2.
    openAt("courseId=course-1&tab=content&module=m2");
    rerender(tree());
    fireEvent.click(within(card()).getAllByRole("button", { name: "Add video" })[1]);
    expect(screen.getByRole("dialog")).toHaveTextContent("m2:Second");
  }, 10000);

  // No Chrome/Edge, percorrer as opcoes com as setas dispara change na hora:
  // quem navega pelo teclado movia a aula sem querer.
  it("escolher no seletor (setas) nao move nada ate o botao Move", async () => {
    openAt("courseId=course-1&tab=content&module=m1");
    await renderBuilder();

    fireEvent.change(screen.getByRole("combobox", { name: 'Move "Second" to another module' }), {
      target: { value: "m2" },
    });
    expect(titlesOnPage()).toEqual(["Welcome", "Second"]);

    fireEvent.click(screen.getByRole("button", { name: 'Move "Second"' }));
    expect(titlesOnPage()).toEqual(["Welcome"]);
  });

  it.each(positional)("com liberacao por posicao (%s), pede confirmacao nos dois caminhos e cancelar mantem a ordem", async (strategy) => {
    mocks.course = courseWith(strategy);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    openAt("courseId=course-1&tab=content&module=m1");
    const { rerender } = await renderBuilder();

    chooseAndMove("Second", "m2");
    expect(confirm).toHaveBeenLastCalledWith(confirmText);
    expect(titlesOnPage()).toEqual(["Welcome", "Second"]);

    openAt("courseId=course-1&tab=content");
    rerender(tree());
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(within(rowOf("m1")).getByText("Second"), { dataTransfer });
    fireEvent.dragOver(rowOf("m2"), { dataTransfer });
    fireEvent.drop(rowOf("m2"), { dataTransfer });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(within(rowOf("m1")).getByText("Second")).toBeInTheDocument();
    expect(within(rowOf("m2")).queryByText("Second")).not.toBeInTheDocument();
  });

  it.each(["time_drip_custom", "instant"] as DripStrategy[])("com %s, move sem perguntar", async (strategy) => {
    mocks.course = courseWith(strategy);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    openAt("courseId=course-1&tab=content&module=m1");
    await renderBuilder();

    chooseAndMove("Second", "m2");
    expect(confirm).not.toHaveBeenCalled();
    expect(titlesOnPage()).toEqual(["Welcome"]);
  });

  it("o aviso de liberacao aparece so com liberacao por posicao", async () => {
    for (const strategy of positional) {
      mocks.course = courseWith(strategy);
      openAt("courseId=course-1&tab=content&module=m1");
      await renderBuilder();
      expect(within(card()).getByText(/changes when it opens/)).toBeInTheDocument();
      cleanup();
    }
    for (const strategy of ["time_drip_custom", "instant"] as DripStrategy[]) {
      mocks.course = courseWith(strategy);
      openAt("courseId=course-1&tab=content&module=m1");
      await renderBuilder();
      expect(within(card()).queryByText(/changes when it opens/)).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("arrastar a aula para outro modulo na lista do curso usa o mesmo caminho", async () => {
    await renderBuilder();
    const dataTransfer = fakeDataTransfer();

    fireEvent.dragStart(within(rowOf("m1")).getByText("Second"), { dataTransfer });
    fireEvent.dragOver(rowOf("m2"), { dataTransfer });
    fireEvent.drop(rowOf("m2"), { dataTransfer });

    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(idsOf(0)).toEqual(["l1"]);
    expect(idsOf(1)).toEqual(["l3", "l2"]);
    expect(lastPayload()?.modules?.[1].lessons[1]).toEqual(expect.objectContaining(lesson("l2", "Second")));
  }, 10000);

  it("soltar a aula no proprio modulo nao muda nada (nem pergunta)", async () => {
    mocks.course = courseWith("sequential_progress");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderBuilder();
    const dataTransfer = fakeDataTransfer();

    fireEvent.dragStart(within(rowOf("m1")).getByText("Welcome"), { dataTransfer });
    fireEvent.dragOver(rowOf("m1"), { dataTransfer });
    fireEvent.drop(rowOf("m1"), { dataTransfer });

    expect(confirm).not.toHaveBeenCalled();
    await wait(2200);
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  }, 10000);

  it("arrastar texto qualquer nao e aceito pela linha do modulo", async () => {
    await renderBuilder();
    const text = { types: ["text/plain"], getData: (type: string) => (type === "text/plain" ? "l2" : "") };

    // dragOver sem preventDefault = soltura recusada pelo navegador.
    expect(fireEvent.dragOver(rowOf("m2"), { dataTransfer: text })).toBe(true);
    fireEvent.drop(rowOf("m2"), { dataTransfer: text });
    expect(within(rowOf("m1")).getByText("Second")).toBeInTheDocument();

    // O arrastar de uma aula e aceito.
    const lessonDrag = fakeDataTransfer();
    fireEvent.dragStart(within(rowOf("m1")).getByText("Second"), { dataTransfer: lessonDrag });
    expect(fireEvent.dragOver(rowOf("m2"), { dataTransfer: lessonDrag })).toBe(false);
  });
});
