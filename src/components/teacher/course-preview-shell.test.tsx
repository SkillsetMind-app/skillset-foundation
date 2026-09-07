import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CoursePreviewShell } from "@/components/teacher/course-preview-shell";
import type { TeacherCourse } from "@/domain/teacher-course";

const mocks = vi.hoisted(() => ({
  connected: true,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
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
  it.each([
    ["", true, "Course not selected.", "Curso no seleccionado.", "Vuelve al editor y abre la vista previa de un curso específico."],
    ["course-1", false, "Preview is not connected.", "La vista previa no está conectada.", "La conexión con la plataforma debe estar disponible para cargar la vista previa."],
    ["course-1", true, "Loading preview...", "Cargando vista previa...", "Preparando el área de miembros que verán tus alumnos."],
  ] as const)("translates the entry state for %s / connected=%s", (courseId, connected, english, spanish, detail) => {
    mocks.connected = connected;
    renderPreview(courseId);
    expect(screen.getByRole("heading", { name: english })).toBeInTheDocument();
    const subscriptions = mocks.subscribe.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("heading", { name: spanish })).toBeInTheDocument();
    expect(screen.getByText(detail)).toBeInTheDocument();
    expect(screen.getByText("Modo de vista previa")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al estudio del creador" })).toHaveAttribute("href", "/teach");
    expect(mocks.subscribe).toHaveBeenCalledTimes(subscriptions);
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
