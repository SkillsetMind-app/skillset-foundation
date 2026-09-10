import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { SalesPageEditor } from "@/components/teacher/sales-page-editor";
import { CourseLandingEditor } from "@/components/teacher/course-landing-editor";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { CourseLanding } from "@/lib/data/course-landings";
import { getCourseLanding, saveCourseLanding } from "@/lib/data/course-landings";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const state = vi.hoisted(() => ({
  user: { uid: "teacher" },
  plan: "plus",
  landing: { template: "classic", blocks: [] } as CourseLanding,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/lib/data/teacher-courses", () => ({ updateTeacherCourseBuilder: vi.fn() }));
vi.mock("@/lib/data/course-landings", () => ({
  getCourseLanding: vi.fn(async () => state.landing),
  saveCourseLanding: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: vi.fn(async () => ({ currentPlanId: state.plan })),
}));

const course: TeacherCourse = {
  id: "course/$&", ownerId: "teacher", title: "Original course $&",
  summary: "Original summary", category: "Other", status: "draft",
  modules: [], lessonCount: 0, learningOutcomes: ["Original outcome"],
  currency: "USD", priceAmountMinor: 12345, membersTitle: "Saved welcome",
};

function Language() {
  const { setLocale } = useTranslation();
  return <><button onClick={() => setLocale("en")}>EN</button><button onClick={() => setLocale("es")}>ES</button></>;
}
function mount(children: ReactNode, locale: "en" | "es" = "es") {
  return render(<I18nProvider initialLocale={locale}><Language />{children}</I18nProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  state.plan = "plus";
  state.landing = { template: "classic", blocks: [] };
  vi.mocked(saveCourseLanding).mockResolvedValue({ ok: true });
  vi.mocked(updateTeacherCourseBuilder).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("ES-09 editors with the shipped dictionaries", () => {
  it("requires the coordinator to integrate both namespaces in the real dictionaries", () => {
    expect(translate(getDictionary("es"), "teacherSalesCopy.title")).toBe("Editor de la página de ventas");
    expect(translate(getDictionary("es"), "teacherLanding.title")).toBe("Página de ventas");
    expect(translate(getDictionary("en"), "teacherLanding.title")).toBe("Sales page");
  });

  it("localizes sales fields and saved feedback without changing authored data or URLs", async () => {
    mount(<SalesPageEditor course={course} />);
    expect(screen.getByRole("heading", { name: "Editor de la página de ventas" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Título del producto"), { target: { value: "Typed title $&" } });
    expect(screen.getByLabelText("Propuesta de venta / resumen")).toHaveValue(course.summary);
    expect(screen.getByLabelText("Resultados (uno por línea)")).toHaveValue("Original outcome");
    expect(screen.getByRole("link", { name: "Vista previa de la página pública" }))
      .toHaveAttribute("href", "/courses/course%2F%24%26");
    fireEvent.click(screen.getByRole("button", { name: "Guardar página de ventas" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Textos de venta guardados.");
    expect(updateTeacherCourseBuilder).toHaveBeenCalledWith(course.id, expect.objectContaining({
      title: "Typed title $&", summary: course.summary, learningOutcomes: ["Original outcome"],
      currency: "USD", priceAmountMinor: 12345, membersTitle: "Saved welcome",
    }));
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("status")).toHaveTextContent("Sales page copy saved.");
    expect(screen.getByLabelText("Product title")).toHaveValue("Typed title $&");
  });

  it("relocalizes sales errors and pending state while preserving the draft", async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    mount(<SalesPageEditor course={course} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Save sales page" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "ES" }));
    expect(screen.getByRole("button", { name: "Guardando…" })).toBeDisabled();
    reject(new Error("Internal English backend failure"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar la página de ventas.");
    expect(screen.queryByText("Internal English backend failure")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save sales page.");
    expect(screen.getByLabelText("Product title")).toHaveValue(course.title);
  });

  it("keeps the database's fixable reason, translated, instead of a generic failure", async () => {
    vi.mocked(updateTeacherCourseBuilder).mockRejectedValueOnce(new Error("A course with this title already exists. Choose a more specific name."));
    mount(<SalesPageEditor course={course} />);
    fireEvent.click(screen.getByRole("button", { name: "Guardar página de ventas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe un curso con este título. Elige un nombre más específico.");
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("alert")).toHaveTextContent("A course with this title already exists. Choose a more specific name.");
  });

  it("localizes every block field and action while preserving saved blocks on language changes", async () => {
    state.landing = { template: "bold", blocks: [
      { kind: "hero", heading: "Saved therapist $&", subheading: "Saved subtitle", imageUrl: "/uploads/original.jpg" },
      { kind: "about", heading: "About me", body: "Saved biography", imageUrl: "/uploads/photo.jpg" },
      { kind: "method", heading: "My method", body: "Saved method" },
      { kind: "steps", heading: "Steps", steps: [{ title: "Saved step", body: "Saved step body" }] },
      { kind: "testimonials", heading: "Quotes", quotes: [{ quote: "Saved quote", author: "Name $&" }] },
      { kind: "faq", heading: "Questions", items: [{ question: "Saved question?", answer: "Saved answer" }] },
      { kind: "cta", heading: "Ready?", body: "Saved CTA", buttonLabel: "Enrol now" },
    ] };
    const original = structuredClone(state.landing);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mount(<CourseLandingEditor course={course} />);
    expect(screen.getByText("Cargando tu página de ventas…")).toBeInTheDocument();
    await screen.findByLabelText("Título principal");
    for (const name of ["Una línea debajo del título", "URL de la imagen de fondo", "URL de tu foto",
      "Título del paso 1", "Qué ocurre en este paso", "Qué dijeron", "Quién lo dijo",
      "Pregunta", "Respuesta", "Texto del botón"]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { name: "Subir" })).toHaveLength(7);
    expect(screen.getByText(/Atención: esta página usa/)).toHaveTextContent("therapist");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar sección Sobre ti" }));
    expect(confirm).toHaveBeenCalledWith('¿Eliminar la sección "Sobre ti" y todo su contenido?');
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByLabelText("Headline")).toHaveValue("Saved therapist $&");
    expect(screen.getByLabelText("Button label")).toHaveValue("Enrol now");
    expect(getCourseLanding).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save page" }));
    await screen.findByRole("status");
    expect(saveCourseLanding).toHaveBeenCalledWith(course.id, original);
    fireEvent.click(screen.getByRole("button", { name: "ES" }));
    expect(screen.getByRole("status")).toHaveTextContent("Guardado.");
  });

  it("creates localized defaults only on request, retaining them after a language switch", async () => {
    mount(<CourseLandingEditor course={course} />);
    fireEvent.click(await screen.findByRole("button", { name: "Empezar con una página sugerida" }));
    expect(screen.getByLabelText("Título principal")).toHaveValue(course.title);
    expect(screen.getByLabelText("Título del paso 1")).toHaveValue("Primer paso");
    expect(screen.getByLabelText("Texto del botón")).toHaveValue("Inscribirme ahora");
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByLabelText("Button label")).toHaveValue("Inscribirme ahora");
    fireEvent.click(screen.getByRole("button", { name: "Questions" }));
    expect(screen.getAllByLabelText("Heading").at(-1)).toHaveValue("Questions");
    fireEvent.click(screen.getByRole("button", { name: "ES" }));
    expect(screen.getAllByLabelText("Título").at(-1)).toHaveValue("Questions");
  });

  it.each([
    ["This page has more blocks than your plan allows. Remove one, or upgrade.", "Esta página tiene más bloques"],
    ["That template is not included on your plan.", "Esa plantilla no está incluida"],
    ["This page is too long. Shorten a section and try again.", "Esta página es demasiado larga"],
    ["You can only edit your own courses.", "Solo puedes editar tus propios cursos."],
    ["Unknown backend failure", "No se pudo guardar la página."],
  ])("maps the save reason %s without exposing raw backend text", async (reason, spanish) => {
    vi.mocked(saveCourseLanding).mockResolvedValue({ ok: false, reason });
    mount(<CourseLandingEditor course={course} />);
    fireEvent.click(await screen.findByRole("button", { name: "Guardar página" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(spanish);
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() => expect(screen.getByRole("alert")).not.toHaveTextContent(spanish));
  });

  it("preserves the free-plan template and section gates in Spanish", async () => {
    state.plan = "free";
    mount(<CourseLandingEditor course={course} />);
    expect(await screen.findByRole("button", { name: "Destacada — planes de pago" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Empezar con una página sugerida" }));
    expect(screen.getByText("Has utilizado todas las secciones incluidas en tu plan. Elimina una o mejora tu plan para añadir más.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sobre ti" })).toBeDisabled();
  });
});
