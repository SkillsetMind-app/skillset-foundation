import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CreateCourseStart } from "./create-course-start";
import { skillsetCourseCategories, type TeacherCourseProductFormat } from "@/domain/teacher-course";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/lib/data/teacher-courses", () => ({ createTeacherCourse: mocks.create }));
vi.mock("@/lib/posthog/events", () => ({ track: { courseDraftCreated: vi.fn() } }));

function Language() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}
function mount(format: TeacherCourseProductFormat = "course") {
  return render(<I18nProvider initialLocale="es"><Language /><CreateCourseStart ownerId="teacher-1" initialFormat={format} /></I18nProvider>);
}
function fill() {
  fireEvent.change(screen.getByLabelText("Título del producto"), { target: { value: "Original $& course" } });
  fireEvent.change(screen.getByLabelText(/Promesa del producto/), { target: { value: "Original summary $& with enough characters." } });
  const label = translate(getDictionary("es"), "creatorEditor.categorySelect.select").replace("{max}", "5");
  fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.keyDown(document, { key: "Escape" });
}

beforeEach(() => { vi.clearAllMocks(); mocks.create.mockReset().mockResolvedValue("course-123"); });
afterEach(cleanup);

describe("course creation with real EN/ES dictionaries", () => {
  it("requires the integrated namespace and localizes stages, blockers and formats", () => {
    expect(translate(getDictionary("es"), "courseCreation.title")).toBe("Define la base del producto.");
    expect(translate(getDictionary("en"), "courseCreation.title")).toBe("Build the product foundation.");
    const view = mount();
    expect(screen.getByRole("heading", { name: "Define la base del producto." })).toBeVisible();
    const stages = screen.getByRole("list", { name: "Progreso de creación del producto" });
    expect(within(stages).getAllByRole("listitem")).toHaveLength(5);
    expect(stages).toHaveTextContent("Módulos y lecciones · continúa en el editor");
    expect(screen.getByRole("button", { name: /Crear y definir precio/ })).toHaveAccessibleDescription(/3 caracteres.*20 caracteres.*categoría/);
    for (const label of ["Curso en línea", "Programa guiado", "Evento en línea", "Suscripción", "Comunidad", "Programa gratuito"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    expect(view.container.textContent).not.toContain("courseCreation.");
  });

  it.each([
    ["course", "one_time", false, "pricing"],
    ["program", "one_time", false, "pricing"],
    ["free", "free", false, "content"],
    ["subscription", "subscription_monthly", false, "pricing"],
    ["community", "subscription_monthly", true, "pricing"],
    ["event", "one_time", false, "event"],
  ] as const)("preserves %s payload and route across language changes", async (format, paymentType, communityEnabled, tab) => {
    mount(format);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByLabelText("Product title")).toHaveValue("Original $& course");
    fireEvent.submit(screen.getByLabelText("Product title").closest("form")!);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({
      ownerId: "teacher-1", title: "Original $& course", summary: "Original summary $& with enough characters.",
      category: skillsetCourseCategories[0], categories: [skillsetCourseCategories[0]], paymentType, communityEnabled,
    }));
    expect(mocks.push).toHaveBeenCalledWith(tab === "event" ? "/teach/events?courseId=course-123&newEvent=1" : `/teach/builder?courseId=course-123&tab=${tab}`);
  });

  it("keeps the yearly interval and pending state while changing locale", async () => {
    let finish!: (id: string) => void;
    mocks.create.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    mount("subscription");
    fireEvent.click(screen.getByRole("button", { name: "Anual" }));
    fill();
    fireEvent.submit(screen.getByLabelText("Título del producto").closest("form")!);
    expect(screen.getByRole("button", { name: "Creando..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: "Yearly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ paymentType: "subscription_yearly" }));
    await act(async () => finish("course-123"));
  });

  it.each([
    ["already exists", "duplicateError"], ["Pay the activation fee", "activationError"],
    ["permission denied", "permissionError"], ["summary too short", "summaryError"], ["raw internal failure", "createError"],
  ])("relocalizes the existing %s error without losing input", async (message, key) => {
    mocks.create.mockRejectedValue(new Error(message));
    mount(); fill();
    fireEvent.submit(screen.getByLabelText("Título del producto").closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(translate(getDictionary("es"), `courseCreation.${key}`));
    expect(screen.getByRole("alert")).not.toHaveTextContent("raw internal failure");
    if (key === "activationError") expect(screen.getByRole("link", { name: "Activar tienda" })).toHaveAttribute("href", "/teach/activate");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent(translate(getDictionary("en"), `courseCreation.${key}`));
    expect(screen.getByLabelText("Product title")).toHaveValue("Original $& course");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
