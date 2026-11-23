import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CoursePreviewShell } from "@/components/teacher/course-preview-shell";
import type { TeacherCourse } from "@/domain/teacher-course";

const mocks = vi.hoisted(() => ({
  connected: true,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseClientConfig: () => mocks.connected ? { url: "https://fixture.invalid" } : null,
}));
vi.mock("@/lib/data/teacher-courses", () => ({ subscribeToTeacherCourse: mocks.subscribe }));
vi.mock("@/components/learn/enrolled-course-workspace", () => ({
  EnrolledCourseWorkspace: ({ course, previewMode, previewExitHref, tab, whitelabel }: {
    course: { title: string }; previewMode: boolean; previewExitHref: string; tab: string; whitelabel: boolean;
  }) => <div data-testid="workspace" data-preview={previewMode} data-tab={tab} data-whitelabel={whitelabel}>
    {course.title}<a href={previewExitHref}>Fixture exit</a>
  </div>,
}));

function SwitchLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Switch language</button>;
}

function renderPreview(courseId = "course-1") {
  return render(<I18nProvider initialLocale="en"><SwitchLanguage /><CoursePreviewShell courseId={courseId} tab="materials" whitelabel /></I18nProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connected = true;
  mocks.subscribe.mockReturnValue(mocks.unsubscribe);
});

describe("localized preview entry without reconnecting the course", () => {
  // A volta é o construtor (do curso, quando há um), não o início do estúdio.
  it.each([
    ["", true, "Course not selected.", "Curso no seleccionado.", "Vuelve al editor y abre la vista previa de un curso específico.", "/teach/builder"],
    ["course-1", false, "Preview is not connected.", "La vista previa no está conectada.", "La conexión con la plataforma debe estar disponible para cargar la vista previa.", "/teach/builder?courseId=course-1"],
  ] as const)("translates the entry state for %s / connected=%s", (courseId, connected, english, spanish, detail, backHref) => {
    mocks.connected = connected;
    renderPreview(courseId);
    expect(screen.getByRole("heading", { name: english })).toBeInTheDocument();
    const subscriptions = mocks.subscribe.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("heading", { name: spanish })).toBeInTheDocument();
    expect(screen.getByText(detail)).toBeInTheDocument();
    expect(screen.getByText("Modo de vista previa")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al editor del curso" })).toHaveAttribute("href", backHref);
    expect(mocks.subscribe).toHaveBeenCalledTimes(subscriptions);
  });

  // Carregando: a espera da sala (ClassroomLoading), a mesma do fallback da
  // rota e da propria sala, sem titulo nem "Back" para uma espera (F-03).
  it("keeps the classroom's loading blocks while the course loads", () => {
    renderPreview();
    expect(screen.getByRole("status")).toHaveTextContent("Loading course...");
    expect(screen.getByRole("status").closest("section")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("status")).toHaveTextContent("Cargando curso...");
  });

  // F-11: a falha tinha so "Back". "Try again" assina o curso de novo, sem
  // recarregar a pagina.
  it("offers Try again on a load failure and subscribes again", () => {
    let fail: () => void = () => {};
    let emit: (course: TeacherCourse | null) => void = () => {};
    mocks.subscribe.mockImplementation((_id, onCourse, onError) => {
      emit = onCourse;
      fail = onError;
      return mocks.unsubscribe;
    });
    renderPreview();
    act(() => fail());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("Loading course...");
    act(() => emit({ id: "course-1", ownerId: "teacher-1", title: "Curso", summary: "", category: "Leadership", status: "draft", modules: [], lessonCount: 0 }));
    expect(screen.getByTestId("workspace")).toHaveTextContent("Curso");
  });

  it("translates an already-visible failure without subscribing again, then recovers on the same channel", () => {
    let emit: (course: TeacherCourse | null) => void = () => {};
    let fail: () => void = () => {};
    mocks.subscribe.mockImplementation((_id, onCourse, onError) => {
      emit = onCourse;
      fail = onError;
      return mocks.unsubscribe;
    });
    const { unmount } = renderPreview();
    act(() => fail());
    expect(screen.getByText("We could not load this course preview.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("heading", { name: "Vista previa no disponible." })).toBeInTheDocument();
    expect(screen.getByText("No pudimos cargar la vista previa de este curso.")).toBeInTheDocument();
    expect(screen.queryByText("We could not load this course preview.")).not.toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledOnce();
    act(() => emit({ id: "course-1", ownerId: "teacher-1", title: "Curso $$50; literal $&", summary: "Author", category: "Leadership", status: "draft", modules: [], lessonCount: 0 }));
    expect(screen.getByTestId("workspace")).toHaveTextContent("Curso $$50; literal $&");
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-preview", "true");
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-tab", "materials");
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-whitelabel", "true");
    expect(screen.getByRole("link", { name: "Fixture exit" })).toHaveAttribute("href", "/teach/builder?courseId=course-1&tab=members");
    expect(mocks.subscribe).toHaveBeenCalledOnce();
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  // "Exit preview" navegava esta aba para o construtor: dois construtores
  // salvando o mesmo curso. Aberta pelo construtor, a aba fecha.
  describe("leaving the preview", () => {
    const course = { id: "course-1", ownerId: "teacher-1", title: "Curso", summary: "", category: "Leadership", status: "draft" as const, modules: [], lessonCount: 0 };
    const exitHref = "/teach/builder?courseId=course-1&tab=members";

    function builderTab(overrides: { closed?: boolean; pathname?: string; search?: string; crossOrigin?: boolean } = {}) {
      const location = { origin: window.location.origin, pathname: overrides.pathname ?? "/teach/builder", search: overrides.search ?? "?courseId=course-1&tab=pricing" };
      return {
        closed: overrides.closed ?? false,
        focus: vi.fn(),
        get location() {
          if (overrides.crossOrigin) throw new DOMException("Blocked a frame", "SecurityError");
          return location;
        },
      };
    }

    // A aba de origem fica guardada no módulo (sobrevive à troca de aba da
    // prévia): cada caso carrega o módulo de novo, com o seu opener.
    async function exitClick(opener: unknown, { closes = true }: { closes?: boolean } = {}) {
      // Relógio simulado em TODO caso: o clique agenda um setTimeout de 150 ms
      // que lê window.closed. Com relógio real, o de um caso disparava no meio
      // do seguinte (o afterEach já devolveu closed=false) e chamava o push.
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      vi.resetModules();
      Object.defineProperty(window, "opener", { configurable: true, writable: true, value: opener });
      Object.defineProperty(window, "closed", { configurable: true, writable: true, value: false });
      const close = vi.spyOn(window, "close").mockImplementation(() => {
        if (closes) Object.defineProperty(window, "closed", { configurable: true, writable: true, value: true });
      });
      mocks.subscribe.mockImplementation((_id, onCourse) => { onCourse(course); return mocks.unsubscribe; });
      const { I18nProvider: Provider } = await import("@/components/i18n/i18n-provider");
      const { CoursePreviewShell: Shell } = await import("@/components/teacher/course-preview-shell");
      render(<Provider initialLocale="en"><Shell courseId="course-1" tab="materials" /></Provider>);
      // Montou: a referência foi guardada e window.opener zerado (tabnabbing).
      const openerAfterMount = window.opener;
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      screen.getByRole("link", { name: "Fixture exit" }).dispatchEvent(click);
      return { close, prevented: click.defaultPrevented, openerAfterMount };
    }

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
      Object.defineProperty(window, "opener", { configurable: true, writable: true, value: null });
      Object.defineProperty(window, "closed", { configurable: true, writable: true, value: false });
    });

    it("closes the tab when this course's builder is still open in the tab that opened it", async () => {
      const tab = builderTab();
      const { close, prevented, openerAfterMount } = await exitClick(tab);
      expect(openerAfterMount).toBeNull();
      expect(close).toHaveBeenCalledOnce();
      expect(tab.focus).toHaveBeenCalledOnce();
      expect(prevented).toBe(true);
      expect(mocks.push).not.toHaveBeenCalled();
    });

    it.each([
      ["opened directly (no opener)", null],
      ["the builder tab was closed", builderTab({ closed: true })],
      ["the builder tab moved to another course", builderTab({ search: "?courseId=course-2" })],
      ["the builder tab moved to another screen", builderTab({ pathname: "/teach" })],
      ["the opener is on another origin", builderTab({ crossOrigin: true })],
    ])("%s: does not close, follows the link to this course's builder", async (_label, opener) => {
      const { close, prevented, openerAfterMount } = await exitClick(opener);
      expect(openerAfterMount).toBeNull();
      expect(close).not.toHaveBeenCalled();
      expect(prevented).toBe(false);
    });

    it("if the browser refuses to close, the tab goes to the builder after a moment", async () => {
      const { close, prevented } = await exitClick(builderTab(), { closes: false });
      expect(close).toHaveBeenCalledOnce();
      expect(prevented).toBe(true);
      expect(mocks.push).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith(exitHref);
    });
  });

  it("distinguishes a missing course from a subscription failure", () => {
    mocks.subscribe.mockImplementation((_id, onCourse) => { onCourse(null); return mocks.unsubscribe; });
    renderPreview();
    expect(screen.getByRole("heading", { name: "Course record not found." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("heading", { name: "No se encontró el curso." })).toBeInTheDocument();
    expect(screen.getByText("Es posible que el curso se haya eliminado o que debas actualizar la sesión.")).toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledOnce();
  });
});
