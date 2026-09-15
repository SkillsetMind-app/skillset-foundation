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

describe("mover a aula entre modulos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.course = courseWith();
    openAt("courseId=course-1&tab=content");
  });

  afterEach(() => {
    cleanup();
  });

  it("o seletor da aula leva L2 para o fim de M2 com o mesmo id, e o formulario e o estudio seguem no modulo certo", async () => {
    openAt("courseId=course-1&tab=content&module=m1");
    const { rerender } = await renderBuilder();

    fireEvent.change(screen.getByRole("combobox", { name: 'Move "Second" to another module' }), {
      target: { value: "m2" },
    });
    expect(within(card()).getAllByRole("textbox", { name: "Lesson title" }).map((input) => (input as HTMLInputElement).value))
      .toEqual(["Welcome"]);

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

  it("com liberacao programada ou em sequencia, avisa antes de mover", async () => {
    mocks.course = courseWith("sequential_progress");
    openAt("courseId=course-1&tab=content&module=m1");
    await renderBuilder();
    expect(within(card()).getByText(/changes when it opens/)).toBeInTheDocument();
    cleanup();

    mocks.course = courseWith("instant");
    await renderBuilder();
    expect(within(card()).queryByText(/changes when it opens/)).not.toBeInTheDocument();
  });

  it("arrastar a aula para outro modulo na lista do curso usa o mesmo caminho", async () => {
    await renderBuilder();
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      effectAllowed: "all",
      dropEffect: "move",
    };
    const target = card().querySelector('[data-module-row="m2"]')?.closest("article") as HTMLElement;

    fireEvent.dragStart(within(card()).getByText("Second"), { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(idsOf(0)).toEqual(["l1"]);
    expect(idsOf(1)).toEqual(["l3", "l2"]);
    expect(lastPayload()?.modules?.[1].lessons[1]).toEqual(expect.objectContaining(lesson("l2", "Second")));
  }, 10000);
});
