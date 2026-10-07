import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CreateCourseStart } from "./create-course-start";
import { skillsetCourseCategories, type TeacherCourseProductFormat } from "@/domain/teacher-course";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({ create: vi.fn(), createEvent: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/lib/data/teacher-courses", () => ({ createTeacherCourse: mocks.create }));
vi.mock("@/lib/data/course-events", () => ({ createCourseEvent: mocks.createEvent }));
vi.mock("@/lib/posthog/events", () => ({ track: { courseDraftCreated: vi.fn() } }));

function Language() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}
function mount(format: TeacherCourseProductFormat = "course") {
  const view = render(<I18nProvider initialLocale="es"><Language /><CreateCourseStart ownerId="teacher-1" initialFormat={format} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  return view;
}
function fill() {
  fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Original $& course" } });
  fireEvent.change(screen.getByLabelText(/^Descripción/), { target: { value: "Original summary $& with enough characters." } });
  const label = translate(getDictionary("es"), "creatorEditor.categorySelect.select").replace("{max}", "5");
  fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.keyDown(document, { key: "Escape" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockReset().mockResolvedValue("course-123");
  mocks.createEvent.mockReset().mockResolvedValue("event-1");
});
afterEach(cleanup);

// O evento ao vivo recusa data passada: o relogio fica parado num dia antes
// das datas dos testes, que assim nao vencem.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T12:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});


describe("course creation with real EN/ES dictionaries", () => {
  it("localizes the two screens, the four types and the blockers", () => {
    expect(translate(getDictionary("es"), "courseCreation.title")).toBe("Crea un producto.");
    expect(translate(getDictionary("en"), "courseCreation.title")).toBe("Create a product.");
    const view = render(<I18nProvider initialLocale="es"><CreateCourseStart ownerId="teacher-1" /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "Crea un producto." })).toBeVisible();
    expect(screen.getByRole("heading", { name: "¿Qué vas a entregar?" })).toBeVisible();
    const stages = screen.getByRole("list", { name: "Progreso de creación del producto" });
    expect(within(stages).getAllByRole("listitem")).toHaveLength(5);
    expect(stages).toHaveTextContent("Lecciones, archivos o la sesión en vivo · continúa en el editor");
    for (const [label, help] of [
      ["Curso", "Clases grabadas que cada persona ve a su ritmo."],
      ["Comunidad", "Un espacio de miembros donde publicas, respondes y haces encuentros en vivo. Normalmente se paga cada mes."],
      ["Evento en vivo", "Un taller o clase en una fecha fija, por Zoom o Meet."],
      ["E-book", "Un archivo que la persona descarga: PDF, presentaciones, cuaderno de trabajo."],
    ]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toHaveTextContent(help);
    }
    fireEvent.click(screen.getByRole("button", { name: /^Evento en vivo/ }));
    expect(screen.getByRole("heading", { name: "Ponle nombre a tu evento en vivo" })).toBeVisible();
    expect(screen.getByLabelText("Fecha")).toBeVisible();
    expect(screen.getByLabelText("Hora")).toBeVisible();
    expect(screen.getByLabelText("Enlace de Zoom o Meet")).toBeVisible();
    expect(screen.getByRole("button", { name: /^Crear/ })).toHaveAccessibleDescription(/3 caracteres.*20 caracteres.*categoría.*fecha y la hora/);
    expect(view.container.textContent).not.toContain("courseCreation.");
  });

  it.each([
    ["course", "one_time", false, "Módulo 1", "Lección 1"],
    ["community", "subscription_monthly", true, "Módulo 1", "Lección 1"],
    ["ebook", "one_time", false, "Descarga", "Original $& course"],
  ] as const)("preserves %s payload and route across language changes", async (format, paymentType, communityEnabled, moduleTitle, lessonTitle) => {
    mount(format);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Original $& course");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    fireEvent.submit(screen.getByLabelText("Nombre").closest("form")!);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({
      ownerId: "teacher-1", title: "Original $& course", summary: "Original summary $& with enough characters.",
      category: skillsetCourseCategories[0], categories: [skillsetCourseCategories[0]], paymentType, communityEnabled,
      productFormat: format, moduleTitle, lessonTitle,
    }));
    expect(mocks.push).toHaveBeenCalledWith("/teach/builder?courseId=course-123&tab=content");
  });

  it("keeps the event fields and pending state while changing locale", async () => {
    let finish!: (id: string) => void;
    mocks.create.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    mount("live_event");
    fill();
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-11-20" } });
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "08:00" } });
    fireEvent.submit(screen.getByLabelText("Nombre").closest("form")!);
    expect(screen.getByRole("button", { name: "Creando..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-20");
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ productFormat: "live_event" }));
    await act(async () => finish("course-123"));
    await waitFor(() => expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      courseId: "course-123", startsAt: new Date("2026-11-20T08:00").toISOString(),
    })));
  });

  it.each([
    ["already exists", "duplicateError"], ["Pay the activation fee", "activationError"],
    ["permission denied", "permissionError"], ["summary too short", "summaryError"], ["raw internal failure", "createError"],
  ])("relocalizes the existing %s error without losing input", async (message, key) => {
    mocks.create.mockRejectedValue(new Error(message));
    mount(); fill();
    fireEvent.submit(screen.getByLabelText("Nombre").closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(translate(getDictionary("es"), `courseCreation.${key}`));
    expect(screen.getByRole("alert")).not.toHaveTextContent("raw internal failure");
    if (key === "activationError") expect(screen.getByRole("link", { name: "Activar tienda" })).toHaveAttribute("href", "/teach/activate");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent(translate(getDictionary("en"), `courseCreation.${key}`));
    expect(screen.getByLabelText("Name")).toHaveValue("Original $& course");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
