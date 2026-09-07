import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import { getCourseReadiness } from "@/domain/course-readiness";
import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import { publishTeacherCourse, subscribeToTeacherCourse, updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";
import { subscribeToCourseAssets, uploadCourseAsset } from "@/lib/data/course-assets";

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

// Upload de capa depende de APIs de browser que o jsdom nao tem e nao entra
// na conta de readiness.
vi.mock("@/components/teacher/course-asset-uploader", () => ({
  CourseAssetUploader: () => null,
}));

// O painel do produto (numeros, atividade, manutencao) le pedidos, matriculas,
// cupons, avaliacoes e perguntas. Nada disso muda a porcentagem que este
// arquivo mede, e tem prova propria em course-overview-panel.test.tsx.
vi.mock("@/components/teacher/course-overview-panel", () => ({
  CourseOverviewPanel: () => null,
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
    mocks.searchParams.set("courseId", "course-1");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  it("keeps canonical price, currency and release values when their labels change", async () => {
    vi.useFakeTimers();
    renderBuilder("pricing");
    await act(async () => {});
    fireEvent.change(screen.getByRole("textbox", { name: "Price" }), { target: { value: "149,50" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), { target: { value: "BRL" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Content release" }), { target: { value: "time_drip_custom" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("textbox", { name: "Precio" })).toHaveValue("149,50");
    expect(screen.getByRole("combobox", { name: "Moneda" })).toHaveValue("BRL");
    expect(screen.getByRole("combobox", { name: "Disponibilidad del contenido" })).toHaveValue("time_drip_custom");
    expect(screen.getByRole("option", { name: "Calendario por lección" })).toHaveProperty("selected", true);
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
      dripStrategy: "time_drip_custom",
    });
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it.each([0, 1, 2])("keeps a module name literal and cancels its deletion with %i lessons in Spanish", async (count) => {
    const title = "Módulo $$ $& {count}";
    const lessons = Array.from({ length: count }, (_, index) => ({
      id: `l${index}`, title: `Lección ${index}`, type: "text" as const, description: "",
    }));
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, modules: [{ id: "m1", title, lessons }] });
      return () => {};
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    const related = count === 0 ? "" : count === 1 ? " y su 1 lección" : " y sus 2 lecciones";
    expect(confirm).toHaveBeenCalledExactlyOnceWith(`¿Eliminar el módulo "${title}"${related}? No se podrá deshacer después del guardado automático.`);
    expect(screen.getByRole("textbox", { name: "Módulo 1" })).toHaveValue(title);
    expect(screen.getAllByRole("textbox", { name: "Título de la lección" })).toHaveLength(count + 1);
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("localizes an existing module validation error and retains the unsaved lesson fields", async () => {
    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title });
    const lesson = screen.getByRole("textbox", { name: "Lesson title" });
    fireEvent.change(lesson, { target: { value: "Lección $$ $& sin enviar" } });
    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a module title before creating the module.");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe un título antes de crear el módulo.");
    expect(screen.getByRole("textbox", { name: "Título de la lección" })).toBe(lesson);
    expect(lesson).toHaveValue("Lección $$ $& sin enviar");
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it.each(["save", "publish"] as const)("keeps the activation recovery link after a %s error changes language", async (operation) => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, paymentType: "free", priceAmountMinor: 0, modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text" }] }] });
      return () => {};
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
    expect(screen.getByRole("alert")).toHaveTextContent("Activa tu tienda para habilitar la publicación: es un pago único.");
    expect(screen.getByRole("link", { name: "Activar tienda" })).toHaveAttribute("href", "/teach/activate");
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(publishTeacherCourse).toHaveBeenCalledTimes(operation === "publish" ? 1 : 0);
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
      return () => {};
    });
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    renderBuilder("content");
    await act(async () => {});
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
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent("Aula $$ $&");
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
      return unsubscribe;
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

  it("constrains a menu that mounts after the course recovers from an initial load failure", async () => {
    let recover: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, onCourse, onError) => {
      recover = onCourse;
      onError(new Error("Temporary load failure"));
      return () => {};
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
    expect(menu.style.getPropertyValue("--course-nav-height")).toBe("348px");
    expect(observe).toHaveBeenCalledWith(menu.closest(".platform-content"));
  });

  it("keeps the management menu inside its own scrollport when the available height changes", async () => {
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
    expect(menu.style.getPropertyValue("--course-nav-height")).toBe("348px");
    expect(menu.className).toContain("lg:overflow-y-auto");
    expect(menu.className).toContain("lg:max-h-[var(--course-nav-height)]");

    height.mockReturnValue(500);
    act(() => resize());
    expect(menu.style.getPropertyValue("--course-nav-height")).toBe("248px");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
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
      return () => {};
    });
    let emitAssets: (assets: CourseAsset[]) => void = () => {};
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, emit) => {
      emitAssets = emit;
      return () => {};
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
