import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminEnrollmentPanel } from "@/components/admin/admin-enrollment-panel";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { Enrollment } from "@/domain/enrollment";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { UserProfile } from "@/domain/user-profile";

const mocks = vi.hoisted(() => ({ users: vi.fn(), courses: vi.fn(), grants: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/data/admin-users", () => ({ subscribeToAdminUserProfiles: mocks.users }));
vi.mock("@/lib/data/published-courses", () => ({ subscribeToPublishedTeacherCourses: mocks.courses }));
vi.mock("@/lib/data/enrollments", () => ({ subscribeToAdminGrantedEnrollments: mocks.grants, createAdminEnrollmentForTeacherCourse: mocks.create, revokeEnrollment: mocks.revoke }));

const user: UserProfile = { uid: "learner-$$-$&", displayName: "Ana $$ $& Álvarez", email: "ana@example.test", photoURL: null, roles: ["student"], onboardingCompleted: true, createdAt: "", updatedAt: "", lastLoginAt: "" };
const course: TeacherCourse = { id: "course-$$-$&", ownerId: "creator-a", title: 'Curso $$50 $& "Álvarez"', summary: "Autoral", category: "Personal Development", status: "published", modules: [], lessonCount: 0 };
const grant: Enrollment = { id: "grant-a", userId: user.uid, courseId: course.id, courseSlug: "course-a", courseTitle: course.title, courseCategory: course.category, courseImage: "", status: "active", source: "admin", progressPercent: 0, lastLessonId: null };
function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function panel() { return <I18nProvider initialLocale="en"><ChangeLanguage /><AdminEnrollmentPanel /></I18nProvider>; }
function language() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
function deliver(grants = [grant]) {
  act(() => { mocks.users.mock.calls[0][0]([user]); mocks.courses.mock.calls[0][0]([course]); mocks.grants.mock.calls[0][0](grants); });
}
function select() {
  fireEvent.change(screen.getByRole("combobox", { name: "Learner" }), { target: { value: user.uid } });
  fireEvent.change(screen.getByRole("combobox", { name: "Published creator course" }), { target: { value: course.id } });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const subscribe of [mocks.users, mocks.courses, mocks.grants]) subscribe.mockImplementation(() => vi.fn());
  mocks.create.mockResolvedValue(undefined);
  mocks.revoke.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("administrative enrollment presentation", () => {
  it("keeps selected identities and the pending grant while changing language", async () => {
    let finish!: () => void;
    mocks.create.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(panel());
    deliver([]);
    select();
    language();
    expect(screen.getByRole("combobox", { name: "Estudiante" })).toHaveValue(user.uid);
    expect(screen.getByRole("combobox", { name: "Curso publicado del creador" })).toHaveValue(course.id);
    expect(screen.getByRole("option", { name: course.title })).toBeInTheDocument();
    expect(screen.getByText(/las inscripciones de pago siguen llegando desde Stripe/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Crear inscripción administrativa" }));
    expect(mocks.create).toHaveBeenCalledWith(user.uid, course);
    expect(screen.getByRole("button", { name: "Creando inscripción..." })).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();
    language();
    await act(async () => finish());
    expect(screen.getByRole("status")).toHaveTextContent("Admin enrollment created.");
    language();
    expect(screen.getByRole("status")).toHaveTextContent("Inscripción administrativa creada.");
    for (const subscribe of [mocks.users, mocks.courses, mocks.grants]) expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1, 2])("shows %i confirmed grants with translated sources", count => {
    render(panel());
    expect(screen.queryByText("0 active")).toBeNull();
    language();
    deliver(Array.from({ length: count }, (_, index): Enrollment => ({ ...grant, id: `grant-${index}`, source: index ? "manual_demo" : "admin" })));
    expect(screen.getByText(count === 1 ? "1 activa" : `${count} activas`)).toBeInTheDocument();
    if (!count) expect(screen.getByText("Todavía no hay accesos administrativos o de demostración.")).toBeInTheDocument();
    if (count) expect(screen.getByText(/Acceso administrativo/)).toBeInTheDocument();
    if (count === 2) expect(screen.getByText(/Acceso de demostración/)).toBeInTheDocument();
  });

  it.each([false, true])("preserves literal titles and honors revoke confirmation=%s", async confirm => {
    const confirmDialog = vi.spyOn(window, "confirm").mockReturnValue(confirm);
    let finish!: () => void;
    mocks.revoke.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(panel());
    deliver();
    language();
    fireEvent.click(screen.getByRole("button", { name: "Revocar acceso" }));
    expect(confirmDialog).toHaveBeenCalledWith(`¿Revocar el acceso a "${course.title}" de este estudiante? Perderá el acceso de inmediato.`);
    if (!confirm) {
      expect(mocks.revoke).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).toBeNull();
      return;
    }
    expect(mocks.revoke).toHaveBeenCalledWith("grant-a");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Revocando..." })).toBeDisabled();
    language();
    await act(async () => finish());
    expect(screen.getByRole("status")).toHaveTextContent("Enrollment revoked.");
    expect(mocks.revoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["users", "No pudimos cargar los usuarios para la inscripción manual."],
    ["courses", "No pudimos cargar los cursos publicados de los creadores."],
    ["grants", "No pudimos cargar las inscripciones otorgadas."],
  ] as const)("keeps the %s read error visible across unrelated successful reads", (source, message) => {
    render(panel());
    act(() => mocks[source].mock.calls[0][1](new Error("Private read detail")));
    language();
    for (const other of ["users", "courses", "grants"] as const) if (other !== source) act(() => mocks[other].mock.calls[0][0]([]));
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("Private read detail")).toBeNull();
    if (source === "grants") expect(screen.queryByText("Todavía no hay accesos administrativos o de demostración.")).toBeNull();
    act(() => mocks[source].mock.calls[0][0]([]));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["create", "revoke"] as const)("does not show success for a rejected %s", async action => {
    mocks[action].mockRejectedValue(new Error("Private write detail"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(panel());
    deliver();
    select();
    fireEvent.click(screen.getByRole("button", { name: action === "create" ? "Create admin enrollment" : "Revoke access" }));
    await screen.findByRole("alert");
    language();
    expect(screen.getByRole("alert")).toHaveTextContent(action === "create" ? "No pudimos crear esta inscripción." : "No pudimos revocar esta inscripción.");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Private write detail")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Estudiante" })).toHaveValue(user.uid);
  });
});
