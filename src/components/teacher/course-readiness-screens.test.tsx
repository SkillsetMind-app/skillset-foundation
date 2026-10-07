import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import { getCourseReadiness } from "@/domain/course-readiness";
import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import { publishTeacherCourse, subscribeToTeacherCourse, updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";
import { subscribeToCourseAssets, uploadCourseAsset } from "@/lib/data/course-assets";
import { track } from "@/lib/posthog/events";

const mocks = vi.hoisted(() => {
  // Fusivel: um laco de render nao estoura o timeout do vitest, come memoria
  // ate matar o processo. Contamos as inscricoes e explodimos cedo.
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

  // Mesmo curso para as duas telas: titulo, resumo, categoria e um modulo
  // prontos; sem aula e sem preco. Venda avulsa sem parcelamento.
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
    getSubscriptionCounts: () => new Map(subscriptionCounts),
    course,
    // O MESMO objeto em todo render: um usuario novo por render reinscreve
    // os efeitos e entra em laco.
    user: { uid: "teacher-1" },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams("courseId=course-1"),
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
      onData({ creatorVerificationStatus: "none", currentPlanId: "free", ...profileExtra });
      return () => undefined;
    },
  ),
}));
// Pais da conta Stripe do professor: so o parcelamento (Mexico) le.
const profileExtra = vi.hoisted((): { stripeConnectCountry?: string } => ({}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
  fetchCreatorActivationBlocked: () => Promise.resolve(activation.blocked),
}));
const activation = vi.hoisted(() => ({ blocked: false }));

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: vi.fn(() => () => undefined),
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

// Upload de capa depende de APIs de browser que o jsdom nao tem e nao entra
// na conta de readiness.
vi.mock("@/components/teacher/course-asset-uploader", () => ({
  CourseAssetUploader: () => null,
}));

// O painel do produto (numeros, atividade, manutencao) le pedidos, matriculas,
// cupons, avaliacoes e perguntas. Nada disso muda a porcentagem que este
// arquivo mede, e tem prova propria em course-overview-panel.test.tsx. O
// marcador existe para a prova de ORDEM: onde o painel cai em relacao ao
// checklist e decisao do hub, nao do painel.
vi.mock("@/components/teacher/course-overview-panel", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/teacher/course-overview-panel")>(),
  CourseOverviewPanel: () => <div data-testid="course-overview-panel" />,
}));

function SwitchLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Switch language</button>;
}

function renderMembers() {
  mocks.searchParams.set("tab", "members");
  return render(
    <I18nProvider initialLocale="en">
      <SwitchLanguage />
      <CourseBuilderStudio />
    </I18nProvider>,
  );
}

function renderBuilder(tab = "details") {
  mocks.searchParams.set("tab", tab);
  return render(
    <I18nProvider initialLocale="en">
      <SwitchLanguage />
      <CourseBuilderStudio />
    </I18nProvider>,
  );
}

// O professor via, para o mesmo curso, 71% no chip do construtor, 40% na
// barra logo abaixo do chip e 50% no Manage. Cada tela tinha regra propria.
// Agora as tres leem a mesma funcao e mostram o mesmo numero.
describe("o que falta para publicar: um numero so em todas as telas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("section");
    mocks.searchParams.delete("tab");
    mocks.searchParams.delete("module");
    mocks.searchParams.delete("lesson");
    mocks.searchParams.set("courseId", "course-1");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses a compact course heading without the repeated introductory paragraph", async () => {
    const { container } = renderBuilder("content");
    const title = await screen.findByRole("heading", { name: mocks.course.title, level: 1 });
    expect(title).toHaveClass("text-2xl", "break-words");
    expect(title.className).not.toContain("clamp");
    expect(screen.queryByText("Build the course learners will actually experience: details, modules, lessons, media, pricing, drip rules, and publication checks in one guided workspace.")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit, reorder, and clean up modules and lessons")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add module" })).toBeEnabled();
    expect(container.querySelector("#builder-sec-modules")?.className).not.toMatch(/border|rounded|shadow/);
  });

  it.each([
    ["details", "Define las bases del curso."],
    ["pricing", "Presenta la oferta."],
    ["content", "Organiza el contenido."],
    ["members", "Personaliza el área de miembros."],
    ["review", "Publica en el marketplace."],
  ])("keeps the %s step, course and publication gates while switching the builder language", async (tab, heading) => {
    renderBuilder(tab);
    await screen.findByRole("heading", { name: mocks.course.title });
    const subscriptions = vi.mocked(subscribeToTeacherCourse).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("navigation", { name: "Pasos para crear el curso" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: mocks.course.title })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Guardar borrador" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Publicar producto" })).toBeDisabled();
    expect(screen.getByTestId("publish-readiness-bar")).toHaveStyle({ width: "67%" });
    expect(screen.getAllByText("Añade al menos una lección.").length).toBeGreaterThan(0);
    expect(mocks.searchParams.get("tab")).toBe(tab);
    expect(subscribeToTeacherCourse).toHaveBeenCalledTimes(subscriptions);
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
    if (tab === "details") {
      fireEvent.click(screen.getByRole("button", { name: "Continuar a Precios" }));
      expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/teach/builder?courseId=course-1&tab=pricing", { scroll: false });
    }
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("navigation", { name: "Course creation steps" })).toBeInTheDocument();
  });

  it("does not restart the 1800ms autosave when the language changes halfway through", async () => {
    vi.useFakeTimers();
    let finishSave = () => {};
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    renderBuilder();
    await act(async () => {});
    const title = screen.getByRole("textbox", { name: "Course title" });
    fireEvent.change(title, { target: { value: "Curso $$ y $& con borrador" } });
    act(() => vi.advanceTimersByTime(900));
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("textbox", { name: "Título del curso" })).toBe(title);
    expect(title).toHaveValue("Curso $$ y $& con borrador");
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(900));
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1]).toMatchObject({ title: "Curso $$ y $& con borrador", categories: ["Applied Psychology & Behavior"], currency: "USD" });
    expect(screen.getByText("Guardando")).toBeInTheDocument();
    await act(async () => finishSave());
    expect(screen.getByText("Todos los cambios guardados")).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("localizes a visible price block without saving the invalid draft", async () => {
    vi.useFakeTimers();
    renderBuilder("pricing");
    await act(async () => {});
    const price = screen.getByRole("textbox", { name: "Price" });
    fireEvent.change(price, { target: { value: "invalid" } });
    // A faixa "ainda nao publicado" tambem e role="status" (vem do InlineAlert),
    // entao o anuncio se acha pelo proprio texto e a prova e estar numa regiao viva.
    expect(screen.getByText(/fix the price/).closest('[role="status"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText(/corrige el precio/).closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Precio" })).toBe(price);
    expect(price).toHaveValue("invalid");
    act(() => vi.advanceTimersByTime(5000));
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Publicar producto" })).toBeDisabled();
  });

  it("keeps canonical price and currency values when their labels change", async () => {
    vi.useFakeTimers();
    renderBuilder("pricing");
    await act(async () => {});
    fireEvent.change(screen.getByRole("textbox", { name: "Price" }), { target: { value: "149,50" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), { target: { value: "BRL" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("textbox", { name: "Precio" })).toHaveValue("149,50");
    expect(screen.getByRole("combobox", { name: "Moneda" })).toHaveValue("BRL");
    const displayPrice = new Intl.NumberFormat("es", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(149.5);
    expect(screen.getByText((_content, element) => element?.tagName === "SPAN" && element.textContent === displayPrice)).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1800));
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1]).toMatchObject({
      priceAmountMinor: 14950,
      currency: "BRL",
      paymentType: "one_time",
      installmentsEnabled: false,
    });
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  // A liberacao das aulas morava na aba de preco ("Interval days" ao lado da
  // moeda). Agora fica onde as aulas sao montadas, com rotulo simples.
  it("keeps the canonical release values in Curriculum when their labels change", async () => {
    vi.useFakeTimers();
    renderBuilder("content");
    await act(async () => {});
    const release = screen.getByRole("combobox", { name: "Lesson release" });
    fireEvent.change(release, { target: { value: "time_drip_lesson" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Days between releases" }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("combobox", { name: "Liberación de las lecciones" })).toBe(release);
    expect(release).toHaveValue("time_drip_lesson");
    expect(screen.getByRole("option", { name: "Una lección cada pocos días" })).toHaveProperty("selected", true);
    expect(screen.getByRole("textbox", { name: "Días entre cada liberación" })).toHaveValue("7");
    fireEvent.change(release, { target: { value: "time_drip_module" } });
    expect(screen.getByRole("textbox", { name: "Días entre cada liberación" })).toHaveValue("7");
    fireEvent.change(release, { target: { value: "time_drip_custom" } });
    expect(screen.queryByRole("textbox", { name: "Días entre cada liberación" })).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1800));
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1]).toMatchObject({
      dripStrategy: "time_drip_custom",
      dripIntervalDays: 7,
    });
  });

  it.each([0, 1, 2])("keeps a module name literal and cancels its deletion with %i lessons in Spanish", async (count) => {
    const title = "Módulo $$ $& {count}";
    const lessons = Array.from({ length: count }, (_, index) => ({
      id: `l${index}`, title: `Lección ${index}`, type: "text" as const, description: "",
    }));
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, modules: [{ id: "m1", title, lessons }] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    const related = count === 0 ? "" : count === 1 ? " y su 1 lección" : " y sus 2 lecciones";
    expect(confirm).toHaveBeenCalledExactlyOnceWith(`¿Eliminar el módulo "${title}"${related}? No se podrá deshacer después del guardado automático.`);
    // A linha do modulo mostra o nome literal e quantas aulas ele tem; as
    // aulas em si moram na pagina do modulo (?module=M).
    const row = document.querySelector("#builder-sec-modules article") as HTMLElement;
    expect(row.querySelector("strong")?.textContent).toBe(title);
    expect(within(row).getByText(count === 1 ? "1 lección" : `${count} lecciones`)).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("localizes an existing module validation error and retains the unsaved module fields", async () => {
    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title });
    // O formulario do modulo e um pedido na lista; a aula nasce na pagina do
    // modulo (?module=M), entao os dois formularios nao dividem mais a tela.
    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    const description = screen.getByRole("textbox", { name: "Module description" });
    fireEvent.change(description, { target: { value: "Descripción $$ $& sin enviar" } });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a module title before creating the module.");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe un título antes de crear el módulo.");
    expect(screen.getByRole("textbox", { name: "Descripción del módulo" })).toBe(description);
    expect(description).toHaveValue("Descripción $$ $& sin enviar");
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it.each(["save", "publish"] as const)("keeps the activation recovery link after a %s error changes language", async (operation) => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      // A aula precisa de conteudo para o Publish destravar (item lessonMedia).
      emit({ ...mocks.course, paymentType: "free", priceAmountMinor: 0, modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const activation = new Error("Pay the one-time activation fee before publishing courses.");
    if (operation === "save") vi.mocked(updateTeacherCourseBuilder).mockRejectedValueOnce(activation);
    else vi.mocked(publishTeacherCourse).mockRejectedValueOnce(activation);
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(operation === "save"
      ? screen.getAllByRole("button", { name: "Save draft" })[0]
      : screen.getByRole("button", { name: "Publish product" }));
    await screen.findByRole("link", { name: "Activate storefront" });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Activa tu tienda para habilitar la publicación: una tarifa única de activación, que se cobra una sola vez por cuenta de creador, nunca por curso.");
    expect(screen.getByRole("link", { name: "Activar tienda" })).toHaveAttribute("href", "/teach/activate?courseId=course-1");
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(publishTeacherCourse).toHaveBeenCalledTimes(operation === "publish" ? 1 : 0);
  });

  // A studio with stale assets can let Publish through; the server refusal for
  // an empty lesson must read as the same "every lesson" rule, not "try again".
  it("maps the server empty-lesson refusal to the lesson content message", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, paymentType: "free", priceAmountMinor: 0, modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    vi.mocked(publishTeacherCourse).mockRejectedValueOnce(
      new Error("Every lesson needs a video, text or a file before publishing."),
    );
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getByRole("button", { name: "Publish product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a video, text or file to every lesson before publishing.");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Añade un video, texto o archivo a cada lección antes de publicar.");
  });

  it("translates a completed save without repeating it", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await screen.findByText("Draft saved.");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText("Borrador guardado.")).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
  });

  it("keeps the new lesson pending across a locale change until the saved course echoes its id", async () => {
    vi.useFakeTimers();
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    let finishSave = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    mocks.searchParams.set("module", "m1");
    const view = renderBuilder("content");
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Lesson title" }), { target: { value: "Aula $$ $&" } });
    fireEvent.click(screen.getByRole("button", { name: "Add lesson" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText("Lección añadida. El editor se abrirá cuando termine el guardado automático…")).toBeInTheDocument();
    expect(screen.getByText("Guardando lección…")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1800));
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    const payload = vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1];
    expect(payload.modules?.[0].lessons[0].title).toBe("Aula $$ $&");
    await act(async () => finishSave());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => emitCourse({ ...mocks.course, ...payload }));
    // A aula abre como pagina (?lesson=L), nao como modal: segue a URL pedida.
    const opened = new URL(String(mocks.router.push.mock.calls.at(-1)?.[0]), "https://example.test");
    expect(opened.searchParams.get("lesson")).toBe(payload.modules?.[0].lessons[0].id);
    mocks.searchParams.set("lesson", opened.searchParams.get("lesson") ?? "");
    view.rerender(
      <I18nProvider initialLocale="en">
        <SwitchLanguage />
        <CourseBuilderStudio />
      </I18nProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Aula $$ $&" })).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("keeps the course-cover upload and translates its eventual failure", async () => {
    let rejectUpload: (error: Error) => void = () => {};
    vi.mocked(uploadCourseAsset).mockImplementationOnce((input) => {
      input.onProgress?.({ bytesTransferred: 512, totalBytes: 1024, percent: 50, state: "running" });
      return new Promise<string>((_resolve, reject) => { rejectUpload = reject; });
    });
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    const file = new File(["fixture"], "cover-$$-$&.png", { type: "image/png" });
    const input = screen.getByLabelText("Upload cover");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByLabelText("Subiendo...")).toBe(input);
    expect(input).toBeDisabled();
    expect(screen.getByText("50%").closest('[role="status"]')).not.toBeNull();
    expect(vi.mocked(uploadCourseAsset).mock.calls[0][0]).toMatchObject({ file, courseId: "course-1", kind: "course_cover", isPreview: false });
    await act(async () => rejectUpload(Object.assign(new Error("permission"), { status: 403 })));
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso para subir archivos a este curso.");
    expect(screen.getByLabelText("Subir portada")).not.toBeDisabled();
    expect(uploadCourseAsset).toHaveBeenCalledOnce();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("uses the current language when leaving a dirty draft and keeps new-tab preview exempt", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container } = renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.change(screen.getByRole("textbox", { name: "Course title" }), { target: { value: "Edited course title" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    const leave = document.createElement("a");
    leave.href = "/teach";
    leave.textContent = "Leave fixture";
    container.appendChild(leave);
    expect(fireEvent.click(leave)).toBe(false);
    expect(confirm).toHaveBeenCalledExactlyOnceWith("Este curso tiene cambios sin guardar. ¿Quieres salir y perderlos?");
    const preview = screen.getByRole("link", { name: /^Vista previa.*pestaña nueva/i });
    preview.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(preview);
    expect(confirm).toHaveBeenCalledOnce();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it("translates a read failure and recovers through the original subscription", async () => {
    let recover: (course: TeacherCourse | null) => void = () => {};
    const unsubscribe = vi.fn();
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit, fail) => {
      recover = emit;
      fail(new Error("Temporary fixture failure"));
      return Object.assign(unsubscribe, { reload: async () => {} });
    });
    const { unmount } = renderBuilder();
    expect(screen.getByText(/We could not load this course/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText("No pudimos cargar este curso. Vuelve al estudio del creador e inténtalo de nuevo.")).toBeInTheDocument();
    await act(async () => recover(mocks.course));
    expect(screen.getByRole("navigation", { name: "Pasos para crear el curso" })).toBeInTheDocument();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  // jsdom serve em localhost, que é "fora de produção": o checkout fica relativo
  // (o host curto só resolve em produção) e a página do produto segue em www.
  it("offers permanent checkout and product page links in Promo links", async () => {
    mocks.searchParams.set("section", "links");
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByRole("button", { name: "Copy Checkout link" });
    expect(screen.getByRole("link", { name: "Open Checkout" })).toHaveAttribute("href", "/courses/course-1/checkout");
    expect(screen.getByRole("link", { name: "Open Product page" })).toHaveAttribute("href", "https://www.skillsetmind.com/courses/course-1");
    expect(screen.getByRole("link", { name: "Open Checkout" })).not.toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Open Product page" })).not.toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "Copy Checkout link" })).toBeInTheDocument();
  });

  it("publishes the checkout link on pay.skillsetmind.com in production and keeps the product page on www", async () => {
    vi.stubGlobal("location", { ...window.location, hostname: "www.skillsetmind.com" });
    mocks.searchParams.set("section", "links");
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByRole("button", { name: "Copy Checkout link" });
    expect(screen.getByRole("link", { name: "Open Checkout" })).toHaveAttribute("href", "https://pay.skillsetmind.com/courses/course-1/checkout");
    expect(screen.getByRole("link", { name: "Open Product page" })).toHaveAttribute("href", "https://www.skillsetmind.com/courses/course-1");
  });

  const expected = getCourseReadiness(mocks.course);

  it("observes navigation that mounts after the course recovers from an initial load failure", async () => {
    let recover: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, onCourse, onError) => {
      recover = onCourse;
      onError(new Error("Temporary load failure"));
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const observe = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      observe = observe;
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect({ y: this.classList.contains("platform-content") ? 65 : 269 });
    });
    render(
      <section className="platform-content" style={{ paddingTop: 28, paddingBottom: 48 }}>
        <CourseManageHub courseId="course-1" />
      </section>,
    );
    expect(screen.queryByRole("navigation", { name: "Course management sections" })).toBeNull();

    await act(async () => recover(mocks.course));
    const menu = screen.getByRole("navigation", { name: "Course management sections" });
    expect(menu.style.getPropertyValue("--course-nav-height")).toBe("");
    expect(observe).toHaveBeenCalledWith(menu.closest(".platform-content"));
  });

  it("lets the entire desktop management list grow with the page instead of clipping Sales", async () => {
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect({ y: this.classList.contains("platform-content") ? 65 : 269 });
    });
    const { unmount } = render(
      <section className="platform-content" style={{ paddingTop: 28, paddingBottom: 48 }}>
        <CourseManageHub courseId="course-1" />
      </section>,
    );
    const menu = await screen.findByRole("navigation", { name: "Course management sections" });
    // jsdom structural guard; real geometry is checked in the browser harness.
    expect(menu.style.getPropertyValue("--course-nav-height")).toBe("");
    expect(menu.className).not.toMatch(/overflow-y|max-h|sticky/);
    expect(within(menu).getByRole("button", { name: "Sales" })).toBeInTheDocument();

    height.mockReturnValue(500);
    act(() => resize());
    expect(menu.style.getPropertyValue("--course-nav-height")).toBe("");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  // jsdom has no layout. These explicit scrollports model an offscreen tab;
  // assertions check visibility and ancestor position, not a scrolling API.
  function managementScrollports(initialWidth = 334) {
    let width = initialWidth;
    let vertical = false;
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ offers: [] }) }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("platform-content")) return new DOMRect(0, 65, width + 56, 600);
      if (this.tagName === "NAV") return new DOMRect(28, 269, vertical ? 240 : width, vertical ? 720 : 54);
      const menu = this.closest("nav");
      const row = this.tagName === "BUTTON" ? this.parentElement : this;
      if (menu && row?.parentElement === menu) {
        const roadmap = !row.classList.contains("overflow-x-auto");
        if (roadmap && !vertical) return new DOMRect();
        const index = Array.from(row.children).indexOf(this);
        const spanish = row.textContent?.includes("Precios y ofertas");
        const top = 269 + (vertical ? (roadmap ? 640 : 32) - menu.scrollTop : 0);
        if (this.tagName === "BUTTON") {
          return new DOMRect(
            28 + (vertical ? 8 : index * (spanish ? 190 : 139) - row.scrollLeft),
            top + (vertical ? index * 48 : 0),
            vertical ? 224 : spanish ? 156 : 148,
            44,
          );
        }
        return new DOMRect(28, top, vertical ? 240 : width, vertical ? 576 : 44);
      }
      return new DOMRect(28, 269, width, 0);
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.getBoundingClientRect().height;
    });
    return {
      disconnect,
      resize(nextWidth: number, nextVertical = false) {
        width = nextWidth;
        vertical = nextVertical;
        act(() => resize());
      },
    };
  }

  function navigationFixture() {
    return (
      <section className="platform-content" style={{ paddingBottom: 48 }}>
        <CourseManageHub courseId="course-1" />
      </section>
    );
  }

  function expectSectionVisible(name: string, vertical = false) {
    const menu = screen.getByRole("navigation", { name: /Course management sections|Secciones de gestión del curso/ });
    const button = within(menu).getByRole("button", { name });
    const bounds = (vertical ? menu : button.parentElement!).getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
    expect(rect.right).toBeLessThanOrEqual(bounds.right);
    expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
    expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
    return button.parentElement!;
  }

  it.each([false, true])("reveals a direct pricing section after asynchronous load (initial failure: %s)", async (failsFirst) => {
    managementScrollports();
    mocks.searchParams.set("section", "pricing");
    let receive: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, onCourse, onError) => {
      receive = onCourse;
      if (failsFirst) onError(new Error("Temporary load failure"));
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const { container } = render(navigationFixture());
    const viewport = container.querySelector<HTMLElement>(".platform-content")!;
    viewport.scrollTop = 17;
    expect(screen.queryByRole("navigation", { name: "Course management sections" })).toBeNull();

    await act(async () => receive(mocks.course));
    expect(screen.getByRole("heading", { name: "Pricing & checkout" })).toBeInTheDocument();
    expectSectionVisible("Pricing & offers");
    expect(viewport.scrollTop).toBe(17);
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("keeps URL-selected sections visible across history and resize without moving the page or course header", async () => {
    const layout = managementScrollports();
    const { container, rerender, unmount } = render(navigationFixture());
    await screen.findByRole("navigation", { name: "Course management sections" });
    const viewport = container.querySelector<HTMLElement>(".platform-content")!;
    const menu = screen.getByRole("navigation", { name: "Course management sections" });
    const header = menu.parentElement!.previousElementSibling as HTMLElement;
    const headerTop = header.getBoundingClientRect().top;
    viewport.scrollTop = 17;
    expect(expectSectionVisible("Panel").scrollLeft).toBe(0);

    mocks.searchParams.set("section", "pricing");
    rerender(navigationFixture());
    const row = expectSectionVisible("Pricing & offers");
    const previousScroll = row.scrollLeft;
    layout.resize(334);
    expect(row.scrollLeft).toBe(previousScroll);
    layout.resize(264);
    expectSectionVisible("Pricing & offers");

    mocks.searchParams.delete("section");
    rerender(navigationFixture());
    expectSectionVisible("Panel");
    mocks.searchParams.set("section", "assistant");
    rerender(navigationFixture());
    const hiddenScroll = row.scrollLeft;
    layout.resize(1200, true);
    expectSectionVisible("Sales assistant", true);
    expect(menu.scrollTop).toBe(0);
    expect(row.scrollLeft).toBe(hiddenScroll);
    mocks.searchParams.delete("section");
    rerender(navigationFixture());
    expectSectionVisible("Panel", true);
    expect(viewport.scrollTop).toBe(17);
    expect(header.getBoundingClientRect().top).toBe(headerTop);
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
    const previousDisconnects = layout.disconnect.mock.calls.length;
    unmount();
    expect(layout.disconnect).toHaveBeenCalledTimes(previousDisconnects + 1);
  });

  it.each([
    ["en", "Scroll to previous sections", "Scroll to more sections"],
    ["es", "Desplazar a secciones anteriores", "Desplazar a más secciones"],
  ] as const)("%s: scroll controls expose both directions and stop at the ends without navigating", async (locale, previousLabel, nextLabel) => {
    const layout = managementScrollports();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(600);
    render(<I18nProvider initialLocale={locale}>{navigationFixture()}</I18nProvider>);
    const next = await screen.findByRole("button", { name: nextLabel });
    const previous = screen.getByRole("button", { name: previousLabel });
    const menu = screen.getByRole("navigation");
    const row = menu.querySelector<HTMLElement>(".overflow-x-auto")!;
    // Model only the browser's scroll operation; the real component owns the controls.
    row.scrollBy = vi.fn((options?: ScrollToOptions | number) => {
      const left = typeof options === "number" ? options : options?.left ?? 0;
      row.scrollLeft = Math.max(0, Math.min(400, row.scrollLeft + left));
      fireEvent.scroll(row);
    });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(row.scrollLeft).toBe(200);
    expect(previous).toBeEnabled();
    fireEvent.click(next);
    expect(row.scrollLeft).toBe(400);
    expect(next).toBeDisabled();
    fireEvent.click(previous);
    expect(row.scrollLeft).toBe(200);
    expect(next).toBeEnabled();
    row.scrollLeft = 0;
    fireEvent.scroll(row);
    expect(previous).toBeDisabled();
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(200);
    layout.resize(1200, true);
    expect(next).toBeDisabled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("keeps pricing visible through ES to EN and back without a URL change or resize", async () => {
    managementScrollports(264);
    mocks.searchParams.set("section", "pricing");
    const { container } = render(
      <I18nProvider initialLocale="es">
        <SwitchLanguage />
        {navigationFixture()}
      </I18nProvider>,
    );
    await screen.findByRole("heading", { name: "Precios y checkout" });
    const row = expectSectionVisible("Precios y ofertas");
    const viewport = container.querySelector<HTMLElement>(".platform-content")!;
    const menu = row.closest("nav")!;
    const header = menu.parentElement!.previousElementSibling as HTMLElement;
    const headerTop = header.getBoundingClientRect().top;
    const rowWidth = row.getBoundingClientRect().width;
    viewport.scrollTop = 17;
    const query = mocks.searchParams.toString();

    for (const label of ["Pricing & offers", "Precios y ofertas"]) {
      fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
      expectSectionVisible(label);
      expect(row.getBoundingClientRect().width).toBe(rowWidth);
      expect(viewport.scrollTop).toBe(17);
      expect(header.getBoundingClientRect().top).toBe(headerTop);
      expect(mocks.searchParams.toString()).toBe(query);
    }
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("fits the members preview to the intrinsic stage height, including height-only changes, and disconnects", async () => {
    let resize: (entries: { target: Element; contentRect: { width: number; height: number } }[]) => void = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: typeof resize) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    mocks.searchParams.set("tab", "members");
    const { container, unmount } = render(<CourseBuilderStudio />);
    await screen.findByText("Live preview");

    const frame = container.querySelector<HTMLDivElement>(
      "#builder-sec-members [data-members-theme][aria-hidden='true']",
    );
    expect(frame).toBeInTheDocument();
    expect(observe).toHaveBeenCalledWith(frame);
    const stage = frame?.firstElementChild as HTMLDivElement;
    expect(observe).toHaveBeenCalledWith(stage);
    const scaledWidth = () =>
      Number(stage.style.transform.slice(6, -1)) * Number.parseFloat(stage.style.width);

    act(() => resize([
      { target: frame!, contentRect: { width: 170, height: 0 } },
      { target: stage, contentRect: { width: 1080, height: 220 } },
    ]));
    expect(Number.parseFloat(frame!.style.height)).toBeCloseTo(220 * 170 / 1080);
    expect(scaledWidth()).toBeCloseTo(170);

    // A media query, font or title can change the hero height without changing
    // the frame width. Observing only the width leaves a blank strip or clips it.
    act(() => resize([{ target: stage, contentRect: { width: 1080, height: 540 } }]));
    expect(Number.parseFloat(frame!.style.height)).toBeCloseTo(85);
    expect(scaledWidth()).toBeCloseTo(170);

    act(() => resize([{ target: frame!, contentRect: { width: 340, height: 85 } }]));
    expect(frame).toHaveStyle({ height: "170px" });
    expect(scaledWidth()).toBeCloseTo(340);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(disconnect).not.toHaveBeenCalled();

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("keeps both previews native new-tab links without saving or publishing on click", async () => {
    renderMembers();
    await screen.findByText("Live preview");
    for (const locale of ["en", "es"]) {
      const labels = locale === "en"
        ? [/^Preview.*opens in a new tab/i, /^Open full preview.*opens in a new tab/i]
        : [/^Vista previa.*abre en una pestaña nueva/i, /^Abrir vista previa completa.*abre en una pestaña nueva/i];
      for (const label of labels) {
        const link = screen.getByRole("link", { name: label });
        expect(link.tagName).toBe("A");
        expect(link).toHaveAttribute("href", "/teach/builder/course-1/preview");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
        fireEvent.click(link);
      }
      if (locale === "en") fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    }
    expect(screen.getByText("La vista previa completa abre la última versión guardada en una pestaña nueva. Espera a que termine el guardado automático antes de abrirla.")).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("translates a visible invalid-cover error while keeping author drafts and theme literal", async () => {
    renderMembers();
    await screen.findByText("Live preview");
    const fields = [
      ["Members area title", "Título del área de miembros", "Curso $$50 $&"],
      ["Subtitle", "Subtítulo", "Mi estudio $$ y $&"],
      ["Description", "Descripción", "Bienvenida literal $$ / $&"],
    ];
    for (const [label, , value] of fields) {
      fireEvent.change(screen.getByRole("textbox", { name: new RegExp(`^${label}`) }), { target: { value } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    fireEvent.change(screen.getByLabelText("Upload cover"), { target: { files: [new File(["no"], "invalid.txt", { type: "text/plain" })] } });
    expect(screen.getByText(/Use an image file under/)).toBeInTheDocument();
    const subscriptions = vi.mocked(subscribeToTeacherCourse).mock.calls.length;
    const assetSubscriptions = vi.mocked(subscribeToCourseAssets).mock.calls.length;
    const saves = vi.mocked(updateTeacherCourseBuilder).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText(/Usa una imagen de menos de/)).toBeInTheDocument();
    expect(screen.queryByText(/Use an image file under/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Oscuro" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Personaliza el área de miembros." })).toBeInTheDocument();
    for (const [, label, value] of fields) expect(screen.getByRole("textbox", { name: new RegExp(`^${label}`) })).toHaveValue(value);
    expect(subscribeToTeacherCourse).toHaveBeenCalledTimes(subscriptions);
    expect(subscribeToCourseAssets).toHaveBeenCalledTimes(assetSubscriptions);
    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(saves);
    expect(uploadCourseAsset).not.toHaveBeenCalled();
  });

  it("keeps the same pending cover upload and progress through locale changes, then translates its failure", async () => {
    let rejectUpload: (error: Error) => void = () => {};
    vi.mocked(uploadCourseAsset).mockImplementationOnce((input) => {
      input.onProgress?.({ bytesTransferred: 512, totalBytes: 1024, percent: 50, state: "running" });
      return new Promise<string>((_resolve, reject) => { rejectUpload = reject; });
    });
    renderMembers();
    await screen.findByText("Live preview");
    const file = new File(["fixture"], "cover-$$-$&.png", { type: "image/png" });
    const input = screen.getByLabelText("Upload cover");
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("50%").closest('[role="status"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByLabelText("Subiendo...")).toBe(input);
    expect(input).toBeDisabled();
    expect(screen.getByText("50%").closest('[role="status"]')).not.toBeNull();
    expect(uploadCourseAsset).toHaveBeenCalledOnce();
    expect(vi.mocked(uploadCourseAsset).mock.calls[0][0]).toMatchObject({ file, courseId: "course-1", ownerId: "teacher-1", kind: "members_cover", isPreview: false });
    const subscriptions = vi.mocked(subscribeToCourseAssets).mock.calls.length;
    await act(async () => rejectUpload(Object.assign(new Error("permission"), { status: 403 })));
    expect(screen.getByText("No tienes permiso para subir archivos a este curso.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText("You do not have permission to upload files to this course.")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload cover")).not.toBeDisabled();
    expect(subscribeToCourseAssets).toHaveBeenCalledTimes(subscriptions);
    expect(uploadCourseAsset).toHaveBeenCalledOnce();
  });

  it("renders and removes a newly uploaded cover while preserving the author's literal title in both alt texts", async () => {
    const authorTitle = "Curso $$50; código $&.";
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, title: authorTitle });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    let emitAssets: (assets: CourseAsset[]) => void = () => {};
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, emit) => {
      emitAssets = emit;
      return Object.assign(() => {}, { reload: async () => undefined });
    });
    vi.mocked(uploadCourseAsset).mockResolvedValueOnce("new-cover");
    renderMembers();
    await screen.findByText("Live preview");
    await act(async () => fireEvent.change(screen.getByLabelText("Upload cover"), { target: { files: [new File(["image"], "cover.png", { type: "image/png" })] } }));
    act(() => emitAssets([{ id: "new-cover", courseId: "course-1", ownerId: "teacher-1", kind: "members_cover", fileName: "cover.png", contentType: "image/png", size: 5, storagePath: "fixture/cover.png", downloadUrl: "/fixture-cover.png", isPreview: false, lessonId: null }]));
    expect(screen.getByRole("img", { name: `${authorTitle} members cover` })).toHaveAttribute("src", "/fixture-cover.png");
    expect(screen.getByText("Cover set")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("img", { name: `Portada del área de miembros de ${authorTitle}` })).toHaveAttribute("src", "/fixture-cover.png");
    expect(screen.getByText("Portada añadida")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quitar portada" }));
    expect(screen.queryByRole("img", { name: `Portada del área de miembros de ${authorTitle}` })).not.toBeInTheDocument();
    expect(screen.getByText("Aún no hay portada")).toBeInTheDocument();
    expect(uploadCourseAsset).toHaveBeenCalledOnce();
    expect(subscribeToCourseAssets).toHaveBeenCalledOnce();
  });

  it("a funcao pura e a referencia: 4 de 6 checks, 67%", () => {
    expect(expected.doneCount).toBe(4);
    expect(expected.total).toBe(6);
    expect(expected.percent).toBe(67);
  });

  it("construtor: chip, barra, texto do stepper e rodape mostram 67%", async () => {
    render(<CourseBuilderStudio />);

    await screen.findByRole("heading", { name: "Clinical performance foundations" });

    // Chip no cabecalho e "% ready" do rodape.
    const chips = screen.getAllByText(`${expected.percent}% ready`);
    expect(chips.length).toBeGreaterThanOrEqual(2);

    // Texto do stepper e a barra logo abaixo dele.
    expect(screen.getByText(`Publish readiness ${expected.percent}%`)).toBeInTheDocument();
    expect(
      screen.getByText(`${expected.doneCount} of ${expected.total} checks ready`),
    ).toBeInTheDocument();
    expect(screen.getByTestId("publish-readiness-bar")).toHaveStyle({
      width: `${expected.percent}%`,
    });

    // O proximo passo e o rodape vem da mesma lista.
    expect(screen.getAllByText("Add at least one lesson.").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Set a paid price greater than $0, or choose Free.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish product" })).toBeDisabled();
  });

  it.each(["en", "es"] as const)("localizes the real manage checklist from %s without changing publication gates or edit destinations", async (initialLocale) => {
    const paidCourse = {
      ...mocks.course,
      title: "Curso $$ y $& de autoría",
      priceAmountMinor: 12000,
      installmentsEnabled: true,
      installmentsMax: 3,
    };
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit(paidCourse);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const { container } = render(
      <I18nProvider initialLocale={initialLocale}>
        <SwitchLanguage />
        <CourseManageHub courseId="course-1" />
      </I18nProvider>,
    );
    await screen.findByRole("heading", { name: paidCourse.title });
    const subscriptions = mocks.getSubscriptionCounts();
    const rows = () => [...container.querySelectorAll<HTMLElement>("[data-readiness-item]")];
    const state = () => rows().map((row) => ({
      id: row.dataset.readinessItem,
      done: row.classList.contains("bg-[var(--color-success-soft)]"),
      hrefs: [...row.querySelectorAll("a")].map((link) => link.getAttribute("href")),
    }));
    const initialState = state();
    expect(rows()).toHaveLength(11);
    expect(screen.getByTestId("publish-readiness-bar")).toHaveStyle({ width: "75%" });
    if (initialLocale === "en") {
      expect(screen.getByRole("link", { name: "Edit Course title" })).toBeInTheDocument();
      expect(screen.getByText("6 of 8 required steps done · 75% ready")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    }

    const card = screen.getByText("Lista de publicación").closest("section")!;
    for (const [id, label, hint, optional, done, href] of [
      ["title", "Título del curso", "Dale al curso un título de al menos 3 caracteres.", false, true, "/teach/builder?courseId=course-1&tab=details"],
      ["summary", "Descripción", "Escribe una descripción de al menos 20 caracteres.", false, true, "/teach/builder?courseId=course-1&tab=details"],
      ["category", "Categoría del marketplace", "Elige al menos una categoría del marketplace.", false, true, "/teach/builder?courseId=course-1&tab=details"],
      ["cover", "Imagen de portada", "Sube una portada. Aparece en la página del producto y en las tarjetas del marketplace.", true, false, "/teach/builder?courseId=course-1&tab=details"],
      ["module", "Módulo", "Añade al menos un módulo.", false, true, "/teach/builder?courseId=course-1&tab=content"],
      ["lesson", "Lección", "Añade al menos una lección.", false, false, "/teach/builder?courseId=course-1&tab=content"],
      ["pricing", "Precios", "Define un precio mayor que $0 o elige Gratis.", false, true, "/teach/builder?courseId=course-1&tab=pricing"],
      ["outcomes", "Resultados de aprendizaje", "Añade resultados de aprendizaje. Ayudan a vender en la página del producto.", true, false, "/teach/courses/course-1/manage?section=page"],
      ["installments", "Cuotas", "Define un límite de cuotas válido.", false, true, "/teach/builder?courseId=course-1&tab=pricing"],
      ["payouts", "Cobros de Stripe", "Completa la configuración de cobros de Stripe antes de publicar un curso de pago.", false, false, "/account/payments#stripe-connect"],
      ["verification", "Verificación profesional", "Hoy es opcional; será obligatoria cuando se abra la admisión profesional.", true, false, "/teach/verification"],
    ] as const) {
      const row = card.querySelector<HTMLElement>(`[data-readiness-item="${id}"]`)!;
      expect(within(row).getByText(label)).toBeInTheDocument();
      expect(within(row).getByText(hint)).toBeInTheDocument();
      expect(Boolean(within(row).queryByText("Opcional"))).toBe(optional);
      expect(row.classList.contains("bg-[var(--color-success-soft)]")).toBe(done);
      expect(within(row).getByRole("link", {
        name: id === "verification" ? "Abrir verificación" : `Editar ${label}`,
      })).toHaveAttribute("href", href);
      expect(within(row).getAllByRole("link")).toHaveLength(1);
    }
    expect(within(card).getByText("6 de 8 pasos obligatorios listos · 75% listo")).toBeInTheDocument();
    expect(screen.getByTestId("publish-readiness-bar")).toHaveStyle({ width: "75%" });
    expect(state()).toEqual(initialState);
    expect(screen.getByRole("heading", { name: paidCourse.title })).toBeInTheDocument();
    expect(mocks.getSubscriptionCounts()).toEqual(subscriptions);
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  // Um curso podia ser publicado com aulas vazias. O Publish do construtor
  // agora trava e diz qual aula falta; com conteudo nas duas, destrava.
  it.each([
    ["uma aula vazia", false],
    ["conteudo nas duas", true],
  ] as const)("construtor: Publish com %s", async (_case, filled) => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({
        ...mocks.course,
        paymentType: "free",
        priceAmountMinor: 0,
        modules: [{ id: "m1", title: "Start here", lessons: [
          { id: "l1", title: "Welcome", description: "", type: "video", contentText: "Read this first." },
          {
            id: "l2", title: "Empty lesson", description: "", type: "video",
            ...(filled ? { externalUrl: "https://www.youtube.com/watch?v=abc" } : {}),
          },
        ] }],
      });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });

    const hint = "Add a video, text or file to every lesson. Missing: Empty lesson.";
    const publish = screen.getByRole("button", { name: "Publish product" });
    if (filled) {
      expect(publish).toBeEnabled();
      expect(screen.queryByText(hint)).not.toBeInTheDocument();
    } else {
      expect((await screen.findAllByText(hint)).length).toBeGreaterThan(0);
      expect(publish).toBeDisabled();
    }
    expect(publishTeacherCourse).not.toHaveBeenCalled();
  });

  it("Manage: barra e contagem mostram os mesmos 67% e as mesmas pendencias", async () => {
    render(<CourseManageHub courseId="course-1" />);

    await screen.findByText("Publish checklist");

    expect(
      screen.getByText(
        `${expected.doneCount} of ${expected.total} required steps done · ${expected.percent}% ready`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("publish-readiness-bar")).toHaveStyle({
      width: `${expected.percent}%`,
    });

    const list = screen.getByText("Publish checklist").closest("section") ?? document.body;
    expect(within(list).getByText("Add at least one lesson.")).toBeInTheDocument();
    expect(
      within(list).getByText("Set a paid price greater than $0, or choose Free."),
    ).toBeInTheDocument();
  });
});

// Corte 1 da criacao simples: quem escolhe Gratis nao passa pela aba de preco
// inteira, o parcelamento morto some, a liberacao das aulas sai do preco e a
// cobranca recorrente diz "cobrar todo mes / todo ano".
describe("aba de preco sem o que nao se aplica", () => {
  const freeCourse: TeacherCourse = { ...mocks.course, paymentType: "free", priceAmountMinor: 0 };

  function emit(course: TeacherCourse) {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, onData) => {
      onData(course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("tab");
    mocks.searchParams.delete("welcome");
    delete profileExtra.stripeConnectCountry;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("produto gratis: a frase 'This product is free' toma o lugar dos campos de preco, nao dos cartoes", async () => {
    emit(freeCourse);
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.getByText(/^This product is free\./)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Price" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Currency" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Let buyers split the price" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Free preview lesson" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Free/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Charge every month/ })).toBeInTheDocument();
  });

  // Teclado e leitor de tela: antes o grupo de cartoes inteiro desmontava ao
  // escolher Gratis (e a frase ao voltar para pago), e o foco caia no <body>.
  it("trocar entre Gratis e pago deixa o foco no cartao clicado e so os campos de preco somem e voltam", async () => {
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    const free = screen.getByRole("button", { name: /^Free/ });
    free.focus();
    fireEvent.click(free);
    expect(free).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toBe(free);
    expect(screen.queryByRole("textbox", { name: "Price" })).not.toBeInTheDocument();
    expect(screen.getByText(/^This product is free\./)).toBeInTheDocument();

    const monthly = screen.getByRole("button", { name: /Charge every month/ });
    monthly.focus();
    fireEvent.click(monthly);
    expect(monthly).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toBe(monthly);
    expect(screen.queryByText(/^This product is free\./)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Price" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Currency" })).toBeInTheDocument();
  });

  it("produto gratis: o checklist de publicar nao pede preco", async () => {
    emit(freeCourse);
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.queryByText(/Set a paid price/)).not.toBeInTheDocument();
    expect(screen.queryByText("Pricing", { selector: "p" })).not.toBeInTheDocument();
    // A venda sem item dizia "Sale available · 0 of 0"; os outros grupos
    // continuam com a contagem.
    expect(document.querySelector('[data-readiness-group="sale"] p')).toHaveTextContent(/^Sale available$/);
    expect(document.querySelector('[data-readiness-group="content"] p')).toHaveTextContent(/^Content saved · \d+ of \d+$/);
    expect(screen.queryByText(/0 of 0/)).not.toBeInTheDocument();
  });

  it("produto pago: mensal e anual dizem que a cobranca se repete", async () => {
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.getByRole("button", { name: /Charge every month/ })).toHaveTextContent("repeats every month until the member cancels");
    expect(screen.getByRole("button", { name: /Charge every year/ })).toHaveTextContent("repeats every year until the member cancels");
    expect(screen.queryByText(/subscription/i)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Price" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Free preview lesson" })).toBeInTheDocument();
  });

  it.each([
    ["flag desligada, conta do Mexico", undefined, "MX"],
    ["flag ligada, conta dos EUA", "true", "US"],
  ])("parcelamento fica escondido: %s", async (_case, flag, country) => {
    if (flag) vi.stubEnv("NEXT_PUBLIC_PAYMENTS_CARD_INSTALLMENTS_ENABLED", flag);
    profileExtra.stripeConnectCountry = country;
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.queryByRole("switch", { name: "Let buyers split the price" })).not.toBeInTheDocument();
    expect(screen.queryByText(/installment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stripe requires/)).not.toBeInTheDocument();
  });

  it("parcelamento aparece com a flag ligada e conta do Mexico, sem jargao da Stripe", async () => {
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_CARD_INSTALLMENTS_ENABLED", "true");
    profileExtra.stripeConnectCountry = "MX";
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    const toggle = screen.getByRole("switch", { name: "Let buyers split the price" });
    expect(toggle).toBeDisabled();
    expect(screen.getByText("Switch the currency to MXN to let buyers split the price.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), { target: { value: "MXN" } });
    expect(toggle).toBeEnabled();
    expect(screen.getByText(/it is not a subscription/)).toBeInTheDocument();
  });

  it("a liberacao das aulas mora no conteudo, nao no preco", async () => {
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.queryByRole("combobox", { name: "Lesson release" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Interval days|Content release/)).not.toBeInTheDocument();
    cleanup();

    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });
    expect(screen.getByRole("heading", { name: "When lessons open" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Lesson release" })).toHaveValue("instant");

    // O intervalo padrao e 1: "Release lessons every 1 days" saia errado.
    fireEvent.change(screen.getByRole("combobox", { name: "Lesson release" }), { target: { value: "time_drip_lesson" } });
    expect(screen.getByRole("textbox", { name: "Days between releases" })).toHaveValue("1");
    expect(screen.queryByText(/Release (lessons|modules) every/)).not.toBeInTheDocument();
  });

  // O atalho "Add a short welcome lesson" da Agenda chega com ?welcome=1: o
  // primeiro modulo ja vem com o nome preenchido.
  it("atalho da aula de boas-vindas: o primeiro modulo nasce com o nome Welcome", async () => {
    emit({ ...mocks.course, modules: [] });
    mocks.searchParams.set("welcome", "1");
    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.getByRole("textbox", { name: "Module title" })).toHaveValue("Welcome");

    // Preenchido uma vez, o parametro sai da URL (replace, sem nova entrada no
    // historico). Recarregar a URL que ficou nao preenche outro "Welcome".
    expect(mocks.router.replace).toHaveBeenCalledOnce();
    const [href, options] = vi.mocked(mocks.router.replace).mock.calls[0];
    const next = new URL(String(href), "https://app.test");
    expect(next.pathname).toBe("/teach/builder");
    expect(next.searchParams.get("welcome")).toBeNull();
    expect(next.searchParams.get("courseId")).toBe("course-1");
    expect(next.searchParams.get("tab")).toBe("content");
    expect(options).toEqual({ scroll: false });

    cleanup();
    mocks.searchParams.delete("welcome");
    emit({ ...mocks.course, modules: [] });
    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });
    expect(screen.getByRole("textbox", { name: "Module title" })).toHaveValue("");
    expect(mocks.router.replace).toHaveBeenCalledOnce();
  });

  it("detalhes chama o texto de Description", async () => {
    renderBuilder("details");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.getByRole("textbox", { name: /^Description/ })).toHaveValue(mocks.course.summary);
    expect(screen.queryByText(/summary/i)).not.toBeInTheDocument();
  });

  it("rodape: Continue cheio, grande e com seta; Back contornado", async () => {
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    const next = screen.getByRole("button", { name: "Continue to Curriculum" });
    const back = screen.getByRole("button", { name: "Back to Details" });
    expect(next).toHaveClass("button-solid", "button-lg");
    expect(next.querySelector("svg")).not.toBeNull();
    expect(back).toHaveClass("button-outline", "button-lg");
    expect(back).not.toHaveClass("button-solid");
  });
});

// O professor de um curso ainda nao publicado abria o Painel e via tres caixas
// vazias — "ninguem comprou este produto ainda", "precisa da sua atencao" e
// "atividade recente" — antes de chegar no que ele foi procurar: o que falta
// para publicar. E cada linha do checklist so descrevia a pendencia, sem levar
// a lugar nenhum.
describe("Painel: o que falta para publicar vem primeiro e cada linha leva a algum lugar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("section");
    mocks.searchParams.delete("tab");
    mocks.searchParams.delete("module");
    mocks.searchParams.delete("lesson");
    vi.restoreAllMocks();
  });

  function checklistCard() {
    const card = screen.getByText("Publish checklist").closest("section");
    if (!card) throw new Error("checklist card nao montou");
    return card;
  }

  it("rascunho: o checklist vem ANTES do painel; publicado: depois", async () => {
    const { unmount } = render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");

    const draftOrder = checklistCard().compareDocumentPosition(
      screen.getByTestId("course-overview-panel"),
    );
    // FOLLOWING = o painel vem DEPOIS do checklist no DOM (e na tela).
    expect(draftOrder & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    vi.mocked(subscribeToTeacherCourse).mockImplementation((_id, onCourse) => {
      onCourse({ ...mocks.course, status: "published" });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");

    const liveOrder = checklistCard().compareDocumentPosition(
      screen.getByTestId("course-overview-panel"),
    );
    expect(liveOrder & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("cada linha leva a tela que EDITA o campo, e nao duplica o link da verificacao", async () => {
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");
    const card = checklistCard();

    const hrefOf = (item: string) =>
      within(card)
        .getByLabelText(`Edit ${item}`)
        .getAttribute("href");

    expect(hrefOf("Course title")).toBe("/teach/builder?courseId=course-1&tab=details");
    expect(hrefOf("Cover image")).toBe("/teach/builder?courseId=course-1&tab=details");
    expect(hrefOf("Lesson")).toBe("/teach/builder?courseId=course-1&tab=content");
    expect(hrefOf("Pricing")).toBe("/teach/builder?courseId=course-1&tab=pricing");
    // Resultados de aprendizagem tem editor de verdade DENTRO do hub.
    expect(hrefOf("Learning outcomes")).toBe(
      "/teach/courses/course-1/manage?section=page",
    );
    // A verificacao ja tem o proprio link na dica: nao ganha um segundo.
    expect(within(card).getByRole("link", { name: "Open verification" })).toBeInTheDocument();
    expect(within(card).queryByLabelText(/^Edit Professional verification$/)).toBeNull();
  });

  it("linha concluida fica verde; linha pendente fica neutra", async () => {
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");
    const card = checklistCard();

    // "Module" esta feito (o curso tem um modulo); "Lesson" nao.
    const done = card.querySelector('[data-readiness-item="module"]');
    const pending = card.querySelector('[data-readiness-item="lesson"]');
    expect(done?.className).toContain("bg-[var(--color-success-soft)]");
    expect(pending?.className).not.toContain("bg-[var(--color-success-soft)]");
  });
});

// A taxa de ativacao so aparecia como erro do banco DEPOIS do clique em Publish,
// o item de payouts nao levava a lugar nenhum e o sucesso nao dava o link para
// divulgar. Agora tudo isso aparece na aba Publish, antes e depois do clique.
describe("publicar sem surpresa", () => {
  const readyFreeCourse: TeacherCourse = {
    ...mocks.course,
    paymentType: "free",
    priceAmountMinor: 0,
    modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit(readyFreeCourse);
      return Object.assign(() => {}, { reload: async () => {} });
    });
  });

  afterEach(() => {
    cleanup();
    activation.blocked = false;
    mocks.searchParams.delete("section");
    mocks.searchParams.delete("tab");
    vi.restoreAllMocks();
  });

  it("lists the one-time activation and sends Activate and publish to checkout with this course", async () => {
    activation.blocked = true;
    const blocked = vi.spyOn(track, "coursePublishBlocked");
    renderBuilder("review");
    const button = await screen.findByRole("button", { name: "Activate and publish" });
    expect(screen.getAllByText("Activation — US$25, one time").length).toBeGreaterThan(0);
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach/activate?courseId=course-1"));
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
    expect(blocked).toHaveBeenCalledWith({ course_id: "course-1", reason: "activation" });

    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("button", { name: "Activar y publicar" })).toBeInTheDocument();
    expect(screen.getAllByText("Activación — US$25, pago único").length).toBeGreaterThan(0);
  });

  it("keeps Publish product for a creator who does not owe the fee", async () => {
    renderBuilder("review");
    expect(await screen.findByRole("button", { name: "Publish product" })).toBeEnabled();
    expect(screen.queryByText("Activation — US$25, one time")).toBeNull();
  });

  it("Manage: the activation row leads to checkout for this course", async () => {
    activation.blocked = true;
    const { container } = render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");
    const row = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[data-readiness-item="activation"]');
      if (!found) throw new Error("activation row missing");
      return found;
    });
    expect(within(row).getByRole("link")).toHaveAttribute("href", "/teach/activate?courseId=course-1");
  });

  it("shows the product link to share right after publishing", async () => {
    vi.mocked(publishTeacherCourse).mockResolvedValueOnce(undefined as never);
    renderBuilder("review");
    fireEvent.click(await screen.findByRole("button", { name: "Publish product" }));
    expect(await screen.findByText("Course published. Its product page is now live.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Product page" })).toHaveAttribute("href", "https://www.skillsetmind.com/courses/course-1");
    expect(screen.getByRole("button", { name: "Copy Product page link" })).toBeInTheDocument();
  });

  it("links the payouts error to Stripe setup and records why publishing was blocked", async () => {
    const blocked = vi.spyOn(track, "coursePublishBlocked");
    vi.mocked(publishTeacherCourse).mockRejectedValueOnce(new Error("Finish Stripe payout onboarding before publishing a paid course."));
    renderBuilder("review");
    fireEvent.click(await screen.findByRole("button", { name: "Publish product" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: "Finish payout onboarding" })).toHaveAttribute("href", "/account/payments#stripe-connect");
    expect(blocked).toHaveBeenCalledWith({ course_id: "course-1", reason: "payouts" });
  });
});

describe("motivo do bloqueio no analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({
        ...mocks.course,
        paymentType: "free",
        priceAmountMinor: 0,
        modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }],
      });
      return Object.assign(() => {}, { reload: async () => {} });
    });
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("tab");
    vi.restoreAllMocks();
  });

  it.each([
    ["the draft save fails", "save", () => vi.mocked(updateTeacherCourseBuilder).mockRejectedValueOnce(new Error("Server said no."))],
    ["the connection drops", "network", () => vi.mocked(publishTeacherCourse).mockRejectedValueOnce(new TypeError("Failed to fetch"))],
    ["the server refuses for an unknown reason", "publish", () => vi.mocked(publishTeacherCourse).mockRejectedValueOnce(new Error("Something odd."))],
  ] as const)("records %s as %s", async (_case, reason, arrange) => {
    const blocked = vi.spyOn(track, "coursePublishBlocked");
    arrange();
    renderBuilder("review");
    fireEvent.click(await screen.findByRole("button", { name: "Publish product" }));
    await screen.findByRole("alert");
    expect(blocked).toHaveBeenCalledExactlyOnceWith({ course_id: "course-1", reason });
  });
});

describe("item de payouts no construtor", () => {
  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("tab");
    vi.restoreAllMocks();
  });

  it("links the pending Stripe payouts item to the payouts setup, like Manage", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, priceAmountMinor: 12000 });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    const item = screen.getAllByText("Stripe payouts")[0].closest("li")!;
    expect(within(item).getByRole("link", { name: "Finish payout onboarding" })).toHaveAttribute("href", "/account/payments#stripe-connect");
  });
});
