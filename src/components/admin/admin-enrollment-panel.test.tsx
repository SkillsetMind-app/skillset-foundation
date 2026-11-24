import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminEnrollmentPanel } from "@/components/admin/admin-enrollment-panel";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";
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

// Revogar pergunta na janela da plataforma (não mais no window.confirm). O
// jsdom não tem showModal/close: o stub faz o mínimo que o navegador faz. Só o
// Date é falso: o confirmar ignora cliques nos primeiros CONFIRM_GUARD_MS.
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
function answer(button: string) {
  const dialog = screen.getByRole("dialog");
  vi.advanceTimersByTime(CONFIRM_GUARD_MS);
  fireEvent.click(within(dialog).getByRole("button", { name: button }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  for (const subscribe of [mocks.users, mocks.courses, mocks.grants]) subscribe.mockImplementation(() => vi.fn());
  mocks.create.mockResolvedValue(undefined);
  mocks.revoke.mockResolvedValue(undefined);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

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

  // I-13: achar a pessoa digitando, sem perder quem já foi escolhido, e o
  // botão cinza dizendo o que falta.
  it("filters learners by name or email, keeps the chosen one and says why create is blocked", () => {
    const other: UserProfile = { ...user, uid: "learner-b", displayName: "Bruno Silva", email: "bruno@example.test" };
    render(panel());
    act(() => { mocks.users.mock.calls[0][0]([user, other]); mocks.courses.mock.calls[0][0]([course]); mocks.grants.mock.calls[0][0]([]); });
    const create = screen.getByRole("button", { name: "Create admin enrollment" });
    expect(create).toBeDisabled();
    expect(create).toHaveAccessibleDescription("Choose a user and a published creator course.");
    const learner = screen.getByRole("combobox", { name: "Learner" });
    const filter = screen.getByRole("searchbox", { name: "Filter learners" });
    const options = () => within(learner).getAllByRole("option").map(option => option.textContent);
    fireEvent.change(filter, { target: { value: " BRUNO@example " } });
    expect(options()).toEqual(["Choose user", "Bruno Silva · bruno@example.test"]);
    fireEvent.change(learner, { target: { value: other.uid } });
    fireEvent.change(filter, { target: { value: "nobody" } });
    expect(learner).toHaveValue(other.uid);
    expect(options()).toEqual(["No account matches this search", "Bruno Silva · bruno@example.test"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Published creator course" }), { target: { value: course.id } });
    expect(create).toBeEnabled();
    expect(screen.queryByText("Choose a user and a published creator course.")).toBeNull();
    // Pronto para clicar: diz para quem vai o acesso.
    expect(create).toHaveAccessibleDescription("Grants access to Bruno Silva · bruno@example.test");
    fireEvent.change(filter, { target: { value: "" } });
    expect(options()).toHaveLength(3);
    language();
    expect(screen.getByRole("searchbox", { name: "Filtrar estudiantes" })).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("never grants to a chosen account that is no longer in the loaded list", () => {
    render(panel());
    deliver([]);
    select();
    const create = screen.getByRole("button", { name: "Create admin enrollment" });
    expect(create).toBeEnabled();
    // A conta sai da lista (apagada, ou fora das linhas que a leitura traz).
    act(() => mocks.users.mock.calls[0][0]([{ ...user, uid: "someone-else", displayName: "Outra Pessoa" }]));
    expect(screen.getByRole("combobox", { name: "Learner" })).toHaveValue("");
    expect(create).toBeDisabled();
    expect(create).toHaveAccessibleDescription("Choose a user and a published creator course.");
    fireEvent.click(create);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  // As três leituras são inscrições: sem "Try again" a equipe só saía do erro
  // recarregando a página (F-11).
  it("a failed read offers Try again, which subscribes to the three lists again", () => {
    render(panel());
    act(() => {
      mocks.users.mock.calls[0][1](new Error("offline"));
      mocks.courses.mock.calls[0][0]([course]);
      mocks.grants.mock.calls[0][1](new Error("offline"));
    });
    expect(screen.getByText("We could not load users for manual enrollment.")).toBeInTheDocument();
    expect(screen.getByText("We could not load granted enrollments.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);

    expect(mocks.users).toHaveBeenCalledTimes(2);
    expect(mocks.courses).toHaveBeenCalledTimes(2);
    expect(mocks.grants).toHaveBeenCalledTimes(2);
    act(() => {
      mocks.users.mock.calls[1][0]([user]);
      mocks.courses.mock.calls[1][0]([course]);
      mocks.grants.mock.calls[1][0]([grant]);
    });
    expect(screen.queryByText("We could not load users for manual enrollment.")).toBeNull();
    expect(screen.queryByText("We could not load granted enrollments.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says nothing while the lists load, then names what is missing", () => {
    render(panel());
    const create = screen.getByRole("button", { name: "Create admin enrollment" });
    expect(create).toBeDisabled();
    expect(create).toHaveAccessibleDescription("");
    act(() => { mocks.users.mock.calls[0][0]([user]); mocks.grants.mock.calls[0][0]([]); });
    expect(create).toHaveAccessibleDescription("");
    act(() => mocks.courses.mock.calls[0][0]([]));
    expect(create).toHaveAccessibleDescription("There is no published creator course to grant yet.");
    language();
    expect(screen.getByRole("button", { name: "Crear inscripción administrativa" })).toHaveAccessibleDescription("Todavía no hay un curso publicado de un creador para dar.");
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
    let finish!: () => void;
    mocks.revoke.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(panel());
    deliver();
    language();
    // Tirar o acesso é o botão vermelho pequeno das outras filas (I-04).
    expect(screen.getByRole("button", { name: "Revocar acceso" })).toHaveClass("button-danger", "min-h-11");
    fireEvent.click(screen.getByRole("button", { name: "Revocar acceso" }));
    const dialog = screen.getByRole("dialog", { name: "¿Revocar este acceso?" });
    expect(dialog).toHaveTextContent(`¿Revocar el acceso a "${course.title}" de este estudiante? Perderá el acceso de inmediato.`);
    // Quem perde o acesso, com o nome literal ($$ e $& não viram padrão).
    expect(dialog).toHaveTextContent(`Estudiante: ${user.displayName}`);
    expect(mocks.revoke).not.toHaveBeenCalled();
    if (!confirm) {
      answer("Cancelar");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mocks.revoke).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).toBeNull();
      return;
    }
    answer("Revocar acceso");
    expect(mocks.revoke).toHaveBeenCalledWith("grant-a");
    expect(screen.queryByRole("status")).toBeNull();
    // O botão da lista e o da janela travam enquanto o pedido roda.
    const pending = screen.getAllByRole("button", { name: "Revocando..." });
    expect(pending).toHaveLength(2);
    for (const button of pending) expect(button).toBeDisabled();
    language();
    await act(async () => finish());
    expect(screen.getByRole("status")).toHaveTextContent("Enrollment revoked.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
    render(panel());
    deliver();
    select();
    fireEvent.click(screen.getByRole("button", { name: action === "create" ? "Create admin enrollment" : "Revoke access" }));
    if (action === "revoke") answer("Revoke access");
    await screen.findByRole("alert");
    // O erro fica no painel, onde já aparecia; a janela fecha.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    language();
    expect(screen.getByRole("alert")).toHaveTextContent(action === "create" ? "No pudimos crear esta inscripción." : "No pudimos revocar esta inscripción.");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Private write detail")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Estudiante" })).toHaveValue(user.uid);
  });
});
