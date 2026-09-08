import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { TeacherCourse } from "@/domain/teacher-course";

// O que a pessoa sofria: a aba Curriculum abria com dois formularios grandes
// sempre expandidos - "Add module" e "Add lesson" (este com um select "Choose
// module" que ela tinha de acertar toda vez) - e so DEPOIS deles vinha a lista
// de modulos, que e o que ela veio ver. No fim da mesma aba ainda vinha a
// biblioteca de midia inteira: 3.138 px de rolagem.

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
      { id: "m2", title: "Deep work", lessons: [] },
    ],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    course,
    // O MESMO objeto em todo render: um usuario novo por render reinscreve os
    // efeitos e entra em laco.
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

// Marcador no lugar da biblioteca: o que se prova aqui e QUANDO ela entra na
// tela, nao o que ela faz por dentro (isso e course-asset-uploader.test.tsx).
vi.mock("@/components/teacher/course-asset-uploader", () => ({
  CourseAssetUploader: () => <div>BIBLIOTECA DE MIDIA</div>,
}));

function renderBuilder() {
  return render(
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>,
  );
}

function curriculumCard() {
  const card = document.querySelector("#builder-sec-modules");
  if (!card) throw new Error("a lista de modulos nao esta na aba de conteudo");
  return card as HTMLElement;
}

describe("aba Curriculum: a lista de modulos vem primeiro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("abre com a lista de modulos e sem nenhum formulario aberto", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });

    const card = curriculumCard();
    expect(card.querySelectorAll("form")).toHaveLength(0);
    expect(card.querySelectorAll("article")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Module 1" })).toHaveValue("Start here");
    expect(screen.getByRole("textbox", { name: "Module 2" })).toHaveValue("Deep work");
    // O select que a pessoa tinha de acertar a cada aula nao existe mais.
    expect(screen.queryByRole("combobox", { name: "Module for this lesson" })).not.toBeInTheDocument();
    // A lista e a primeira coisa da aba, nao a terceira.
    expect(card.previousElementSibling).toBeNull();
  });

  it("so mostra o formulario de modulo depois do clique, e com a descricao recolhida", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });

    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    const form = curriculumCard().querySelector("form");
    expect(form).not.toBeNull();
    expect(within(form as HTMLElement).getByRole("textbox", { name: "Module title" })).toHaveValue("");
    // Titulo obrigatorio a vista; descricao a um clique.
    const details = (form as HTMLElement).querySelector("details");
    expect(details?.open).toBe(false);
    expect(within(details as HTMLElement).getByText("More options")).toBeInTheDocument();

    // A validacao que ja existia continua de pe.
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a module title before creating the module.");

    fireEvent.change(screen.getByRole("textbox", { name: "Module title" }), {
      target: { value: "Recovery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    expect(screen.getByRole("textbox", { name: "Module 3" })).toHaveValue("Recovery");
    expect(curriculumCard().querySelectorAll("form")).toHaveLength(0);
  });

  it("cria a aula dentro do modulo da linha, sem select de modulo", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });

    fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 2" }));
    expect(screen.queryByRole("combobox", { name: "Module for this lesson" })).not.toBeInTheDocument();
    expect(screen.queryByText("Choose module")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Lesson title" }), {
      target: { value: "Focus blocks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add lesson" }));

    const [first, second] = Array.from(curriculumCard().querySelectorAll("article")) as HTMLElement[];
    expect(within(first).getByText("0 lessons")).toBeInTheDocument();
    expect(within(second).getByText("1 lesson")).toBeInTheDocument();
    expect(within(second).getAllByRole("textbox", { name: "Lesson title" })[1]).toHaveValue("Focus blocks");
  });

  // O cabecalho do curriculo dizia "1 modules / 1 lessons" e a estrutura,
  // "1 modules, 1 lessons" — em EN e em ES (QA visual em producao, 08/09).
  it("conta no singular: 1 module, 1 lesson", async () => {
    const modulesOriginais = mocks.course.modules;
    mocks.course.modules = [
      {
        id: "m1",
        title: "Start here",
        lessons: [{ id: "l1", title: "Welcome", type: "text", description: "" }],
      },
    ];
    try {
      renderBuilder();
      await screen.findByRole("heading", { name: mocks.course.title });

      expect(screen.getByText("1 module")).toBeInTheDocument();
      expect(screen.getByText("1 module, 1 lesson")).toBeInTheDocument();
      expect(screen.queryByText("1 modules")).not.toBeInTheDocument();
    } finally {
      mocks.course.modules = modulesOriginais;
    }
  });

  it("nao renderiza a biblioteca de midia ate alguem abrir", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });

    expect(screen.queryByText("BIBLIOTECA DE MIDIA")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open media library" }));
    expect(screen.getByText("BIBLIOTECA DE MIDIA")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide media library" }));
    expect(screen.queryByText("BIBLIOTECA DE MIDIA")).not.toBeInTheDocument();
  });
});
