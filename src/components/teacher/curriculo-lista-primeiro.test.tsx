import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { TeacherCourse } from "@/domain/teacher-course";
import { uploadCourseAsset } from "@/lib/data/course-assets";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

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

function tree() {
  return (
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>
  );
}

function renderBuilder() {
  return render(tree());
}

// Fatia 4: capa, descricao e aulas moram na pagina do modulo (?module=M).
function abrirModulo(id: string) {
  mocks.searchParams = new URLSearchParams(`courseId=course-1&tab=content&module=${id}`);
}

function curriculumCard() {
  const card = document.querySelector("#builder-sec-modules");
  if (!card) throw new Error("a lista de modulos nao esta na aba de conteudo");
  return card as HTMLElement;
}

describe("aba Curriculum: a lista de modulos vem primeiro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("courseId=course-1&tab=content");
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
    // Uma linha por modulo; o nome se edita na pagina dele.
    expect(within(card).getByRole("link", { name: /Start here/ })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Deep work/ })).toBeInTheDocument();
    // O select que a pessoa tinha de acertar a cada aula nao existe mais.
    expect(screen.queryByRole("combobox", { name: "Module for this lesson" })).not.toBeInTheDocument();
    // A lista e a primeira coisa da aba, nao a terceira.
    expect(card.previousElementSibling).toBeNull();
  });

  it("abre titulo e descricao juntos ao criar modulo", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });

    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    const form = curriculumCard().querySelector("form");
    expect(form).not.toBeNull();
    expect(within(form as HTMLElement).getByRole("textbox", { name: "Module title" })).toHaveValue("");
    expect(within(form as HTMLElement).getByRole("textbox", { name: "Module description" })).toBeVisible();
    expect((form as HTMLElement).querySelector("details")).toBeNull();

    // A validacao que ja existia continua de pe.
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a module title before creating the module.");

    fireEvent.change(screen.getByRole("textbox", { name: "Module title" }), {
      target: { value: "Recovery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    expect(within(curriculumCard()).getByRole("link", { name: /Recovery/ })).toBeInTheDocument();
    expect(curriculumCard().querySelectorAll("form")).toHaveLength(0);
    // O modulo novo abre na pagina dele.
    expect(mocks.router.push).toHaveBeenLastCalledWith(
      expect.stringMatching(/[?&]module=module-/),
      { scroll: false },
    );
  });

  it("cria a aula dentro do modulo aberto, sem select de modulo", async () => {
    abrirModulo("m2");
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });

    fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 2" }));
    expect(screen.queryByRole("combobox", { name: "Module for this lesson" })).not.toBeInTheDocument();
    expect(screen.queryByText("Choose module")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Lesson title" }), {
      target: { value: "Focus blocks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add lesson" }));

    expect(within(curriculumCard()).getByText("1 lesson")).toBeInTheDocument();
    expect(within(curriculumCard()).getAllByRole("textbox", { name: "Lesson title" })[1]).toHaveValue("Focus blocks");
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled());
    const saved = vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1].modules;
    expect(saved?.[0].lessons).toEqual([]);
    expect(saved?.[1].lessons).toEqual([expect.objectContaining({ title: "Focus blocks" })]);
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

  it("envia a capa pelo modulo certo e grava o asset sem tocar nas aulas", async () => {
    vi.mocked(uploadCourseAsset).mockResolvedValueOnce("poster-new");
    abrirModulo("m2");
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    const poster = screen.getByRole("region", { name: "Module cover" });
    expect(poster.querySelector('.aspect-\\[2\\/3\\]')).not.toBeNull();
    const description = screen.getByRole("textbox", { name: "Module 2 description" });
    expect(description.closest("details")).toBeNull();
    const file = new File(["png"], "module.png", { type: "image/png" });
    fireEvent.change(within(poster).getByLabelText("Module cover"), { target: { files: [file] } });
    await waitFor(() => expect(uploadCourseAsset).toHaveBeenCalledWith(expect.objectContaining({
      courseId: "course-1", ownerId: "teacher-1", moduleId: "m2", kind: "module_cover", file,
    })));
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled());
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1].modules).toEqual([
      expect.objectContaining({ id: "m1", title: "Start here", lessons: [] }),
      expect.objectContaining({ id: "m2", title: "Deep work", coverAssetId: "poster-new", lessons: [] }),
    ]);
  });

  it("nao permite capa em modulo ainda nao salvo nem pede minutos da aula", async () => {
    const { rerender } = renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Module title" }), { target: { value: "New module" } });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    // O modulo novo abre na pagina dele: segue a URL que o builder empurrou.
    const destino = String(mocks.router.push.mock.calls.at(-1)?.[0]);
    mocks.searchParams = new URL(destino, "https://example.test").searchParams;
    rerender(tree());
    expect(screen.getByLabelText("Module cover", { selector: "input" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 3" }));
    expect(screen.queryByRole("textbox", { name: "Lesson duration" })).not.toBeInTheDocument();
    expect(screen.queryByText("Minutes", { exact: true })).not.toBeInTheDocument();
  });

  it("recusa arquivo invalido e permite repetir uma capa cujo envio falhou", async () => {
    vi.mocked(uploadCourseAsset).mockRejectedValueOnce(new Error("network"));
    abrirModulo("m1");
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.change(screen.getByLabelText("Module cover", { selector: "input" }), {
      target: { files: [new File(["video"], "lesson.mp4", { type: "video/mp4" })] },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(uploadCourseAsset).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Module cover", { selector: "input" }), {
      target: { files: [new File(["png"], "poster.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(uploadCourseAsset).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Module cover", { selector: "input" })).toBeEnabled());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  // Decisao de 14/09: a aula mostra so o titulo e o botao de conteudo. Tipo,
  // dias de espera, nota, texto e link sairam da tela (nao do banco).
  it("linha e formulario da aula mostram so o titulo", async () => {
    const modulesOriginais = mocks.course.modules;
    mocks.course.modules = [
      {
        id: "m1",
        title: "Start here",
        lessons: [{ id: "l1", title: "Welcome", type: "text", description: "" }],
      },
    ];
    try {
      abrirModulo("m1");
      renderBuilder();
      await screen.findByRole("heading", { name: mocks.course.title });

      expect(screen.getByRole("textbox", { name: "Lesson title" })).toHaveValue("Welcome");
      expect(screen.getByRole("button", { name: "Add video" })).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Type" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Delay days" })).not.toBeInTheDocument();
      for (const name of ["Lesson 1 note or outcome", "Lesson 1 text content", "Lesson 1 external link"]) {
        expect(screen.queryByRole("textbox", { name })).not.toBeInTheDocument();
      }

      fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 1" }));
      const form = curriculumCard().querySelector("form") as HTMLElement;
      expect(within(form).queryByRole("combobox")).not.toBeInTheDocument();
      expect(within(form).getAllByRole("textbox")).toHaveLength(1);
    } finally {
      mocks.course.modules = modulesOriginais;
    }
  });

  // Guarda de compatibilidade: a RPC grava content_text/external_url com o
  // que vier no payload (chave ausente vira NULL). Mexer no titulo de uma aula
  // antiga tem de devolver os seis campos intactos, mesmo fora da tela.
  it("editar o titulo de aula antiga preserva os campos que sairam da tela", async () => {
    const modulesOriginais = mocks.course.modules;
    const aulaAntiga = {
      id: "l1",
      title: "Old lesson",
      type: "quiz" as const,
      durationMinutes: 12,
      dripDelayDays: 5,
      contentText: "x",
      externalUrl: "https://drive.google.com/x",
      description: "n",
    };
    mocks.course.modules = [{ id: "m1", title: "Start here", lessons: [aulaAntiga] }];
    try {
      abrirModulo("m1");
      renderBuilder();
      await screen.findByRole("heading", { name: mocks.course.title });
      fireEvent.change(screen.getByRole("textbox", { name: "Lesson title" }), {
        target: { value: "Renamed lesson" },
      });

      // Autosave de verdade (debounce de 1,8 s), sem clicar em salvar.
      await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
      const lessons = vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1].modules?.[0].lessons;
      expect(lessons).toEqual([
        expect.objectContaining({ ...aulaAntiga, title: "Renamed lesson" }),
      ]);
    } finally {
      mocks.course.modules = modulesOriginais;
    }
  }, 10000);
});
