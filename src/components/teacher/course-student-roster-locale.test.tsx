import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { CourseStudent } from "@/lib/data/enrollments";
import { CourseStudentRosterView } from "./course-student-roster";

const mocks = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/data/course-messages", () => ({ sendCourseMessage: mocks.send }));
const student: CourseStudent = {
  enrollmentId: "enrollment-1", courseId: "course-1", courseTitle: "Original course", uid: "learner-1", displayName: "Maria $& Silva",
  email: "maria@example.test", photoUrl: "", status: "active", source: "payment", progressPercent: 42, enrolledAt: "2026-09-09T12:00:00Z",
};
const refunded: CourseStudent = { ...student, enrollmentId: "enrollment-2", uid: "learner-2", displayName: "Original name", email: "other@example.test", status: "refunded", source: "creator", progressPercent: 0 };
function Language() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}
function mount(students: CourseStudent[] = [student], state: "ready" | "error" | "loading" = "ready") {
  return render(<I18nProvider initialLocale="es"><Language /><CourseStudentRosterView state={state} students={students} courseId="course-1" now={new Date("2026-09-10T12:00:00Z")} /></I18nProvider>);
}
function switchLanguage() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
function openMessage() { fireEvent.click(screen.getByRole("button", { name: `Mensaje a ${student.displayName}` })); }
beforeEach(() => { vi.clearAllMocks(); mocks.send.mockReset().mockResolvedValue({ success: true, messageId: "message-1" }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("student roster with real EN/ES dictionaries", () => {
  it("requires integrated keys and translates metrics, headings, filters, dates and sources", () => {
    expect(translate(getDictionary("es"), "courseRoster.title")).toBe("Estudiantes");
    expect(translate(getDictionary("en"), "courseRoster.title")).toBe("Students");
    const view = mount([student, refunded, { ...student, enrollmentId: "enrollment-3", displayName: "", progressPercent: 100, source: "free_course" }]);
    expect(screen.getByText("3 inscritos · 2 con acceso activo")).toBeVisible();
    for (const title of ["Estudiante", "Acceso", "Progreso", "Certificado", "Origen", "Inscripción", "Acciones"]) expect(screen.getByRole("columnheader", { name: title })).toBeInTheDocument();
    for (const metric of ["Inscritos", "Nuevos esta semana", "Completado", "Progreso medio"]) expect(within(screen.getByTestId("roster-summary")).getByText(metric)).toBeVisible();
    for (const label of ["Compra única", "Concedido por el creador", "Inscripción gratuita", "Listo para emitir", "Estudiante sin nombre"]) expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByRole("option", { name: "Sin empezar (0%)" })).toHaveValue("not_started");
    expect(screen.getByRole("option", { name: "Revocado" })).toHaveValue("revoked");
    expect(screen.getAllByText(new Date(student.enrolledAt).toLocaleDateString("es", { year: "numeric", month: "short", day: "numeric" }))).toHaveLength(3);
    expect(screen.getByRole("button", { name: `Mensaje a ${student.displayName}` })).toBeVisible();
    expect(view.container.textContent).not.toContain("courseRoster.");
  });

  it("keeps filter values and search input when relocalizing", () => {
    mount([student, refunded]);
    fireEvent.change(screen.getByLabelText("Filtrar por acceso"), { target: { value: "refunded" } });
    fireEvent.change(screen.getByLabelText("Filtrar por progreso"), { target: { value: "not_started" } });
    fireEvent.change(screen.getByLabelText("Buscar estudiantes por nombre o correo"), { target: { value: "other@" } });
    switchLanguage();
    expect(screen.getByLabelText("Filter by access")).toHaveValue("refunded");
    expect(screen.getByLabelText("Filter by progress")).toHaveValue("not_started");
    expect(screen.getByLabelText("Search students by name or e-mail")).toHaveValue("other@");
    expect(screen.getByText(refunded.displayName)).toBeVisible();
    expect(screen.queryByText(student.displayName)).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter by access"), { target: { value: "revoked" } });
    switchLanguage();
    expect(screen.getByText(/Ningún estudiante coincide/)).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it.each([
    ["loading", "Cargando estudiantes...", "Loading students..."],
    ["error", "No pudimos cargar la lista de estudiantes.", "We could not load the roster."],
    ["ready", "Todavía no hay estudiantes inscritos.", "No one is enrolled yet."],
  ] as const)("localizes the %s state", (state, es, en) => {
    const view = mount([], state);
    expect(view.container).toHaveTextContent(es);
    switchLanguage();
    expect(view.container).toHaveTextContent(en);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("preserves the message body and recipient during a pending language change", async () => {
    let finish!: () => void;
    mocks.send.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    mount(); openMessage();
    expect(screen.getByRole("button", { name: "Enviar mensaje" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: `Mensaje a ${student.displayName}` }), { target: { value: "Original body $& {name}" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    expect(screen.getByRole("button", { name: "Enviando..." })).toBeDisabled();
    switchLanguage();
    expect(screen.getByRole("textbox", { name: `Message ${student.displayName}` })).toHaveValue("Original body $& {name}");
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
    expect(mocks.send).toHaveBeenCalledWith({ courseId: "course-1", studentId: student.uid, body: "Original body $& {name}" });
    await act(async () => finish());
    expect(screen.getByRole("status")).toHaveTextContent(`Message sent to ${student.displayName}.`);
    switchLanguage();
    expect(screen.getByRole("status")).toHaveTextContent(`Mensaje enviado a ${student.displayName}.`);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["RATE_LIMIT", "rateError"], ["This enrollment cannot send messages.", "inactiveMessage"],
    ["You cannot message yourself.", "selfMessage"], ["raw database detail", "sendError"], ["toString", "sendError"],
  ])("relocalizes %s without discarding the message", async (message, key) => {
    mocks.send.mockRejectedValue({ message });
    mount(); openMessage();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unchanged body $&" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(translate(getDictionary("es"), `courseRoster.${key}`));
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent(translate(getDictionary("en"), `courseRoster.${key}`));
    expect(screen.getByRole("textbox")).toHaveValue("Unchanged body $&");
  });

  it("keeps the existing export schema and only exports filtered students", () => {
    mount([student, refunded]);
    fireEvent.change(screen.getByLabelText("Filtrar por acceso"), { target: { value: "refunded" } });
    const downloads: string[] = [];
    vi.stubGlobal("Blob", class { constructor(parts: string[]) { downloads.push(parts.join("")); } });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:export", revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: translate(getDictionary("es"), "platform.ops.exportButton.export") }));
    fireEvent.click(screen.getByRole("menuitem", { name: translate(getDictionary("es"), "platform.ops.exportButton.json") }));
    expect(JSON.parse(downloads[0])).toEqual([{
      name: refunded.displayName, email: refunded.email, access: "refunded", progressPercent: 0,
      certificate: "In progress", source: "Granted by creator", enrolledAt: refunded.enrolledAt,
    }]);
  });
});
