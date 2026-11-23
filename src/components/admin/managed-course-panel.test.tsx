import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedCoursePanel } from "@/components/admin/managed-course-panel";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";
import type { TeacherCourse } from "@/domain/teacher-course";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), remove: vi.fn(), review: vi.fn(), feature: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/data/teacher-courses", () => ({ subscribeToManagedCourses: mocks.subscribe, deleteCourseAsAdmin: mocks.remove, updateCourseReviewStatus: mocks.review, setCourseFeatured: mocks.feature }));

const course: TeacherCourse = {
  id: "course-a", ownerId: "creator-a", title: 'Curso autoral $$50 $& "Álvarez"', summary: "Contenido original", category: "Personal Development", categories: ["Personal Development"], status: "published", modules: [{ id: "m1", title: "Original", lessons: [] }], lessonCount: 2, priceAmountMinor: 5000, currency: "USD", paymentType: "one_time",
};
function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function panel() { return <I18nProvider initialLocale="en"><ChangeLanguage /><ManagedCoursePanel /></I18nProvider>; }
function language() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
function deliver(courses = [course]) { act(() => mocks.subscribe.mock.calls[0][0](courses)); }

beforeEach(() => {
  vi.clearAllMocks();
  // Só o Date é falso: o confirmar ignora cliques nos primeiros CONFIRM_GUARD_MS.
  vi.useFakeTimers({ toFake: ["Date"] });
  // jsdom não tem showModal/close; o mesmo arranjo do teste da janela de conta.
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  mocks.subscribe.mockImplementation(() => vi.fn());
  mocks.remove.mockResolvedValue(undefined);
  mocks.review.mockResolvedValue(undefined);
  mocks.feature.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("catalog presentation and language", () => {
  it.each([0, 1, 2])("translates known counts for %i courses and preserves authored categories", count => {
    render(panel());
    expect(screen.getByRole("status")).toHaveTextContent("Loading published courses");
    expect(screen.queryByText("0 courses")).toBeNull();
    language();
    const rows = Array.from({ length: count }, (_, index) => ({ ...course, id: `course-${index}`, category: index ? "Categoría $$ $& propia" : course.category }));
    deliver(rows);
    expect(screen.getByText(count === 1 ? "1 curso" : `${count} cursos`)).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(count);
    if (!count) expect(screen.getByText("Todavía no hay cursos publicados o inactivos.")).toBeInTheDocument();
    if (count) expect(screen.getByText("Desarrollo personal")).toBeInTheDocument();
    if (count === 2) expect(screen.getByText("Categoría $$ $& propia")).toBeInTheDocument();
    if (count) expect(screen.getAllByText(course.title)).toHaveLength(count);
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it("does not show a read failure as empty and recovers in the current locale", () => {
    render(panel());
    act(() => mocks.subscribe.mock.calls[0][1](new Error("Private read detail")));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load published courses");
    expect(screen.queryByText("No published or inactive courses yet.")).toBeNull();
    language();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los cursos publicados");
    deliver([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Todavía no hay cursos publicados o inactivos.")).toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it("retains delete confirmation across locale changes, cancels safely, and waits for completion", async () => {
    let finish!: () => void;
    mocks.remove.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(panel());
    deliver();
    // Apagar abre a mesma janela do Unpublish: vermelho cheio, Cancelar focado.
    const trigger = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: `Delete ${course.title}?` });
    expect(dialog).toHaveClass("modal-panel");
    expect(within(dialog).getByRole("button", { name: "Delete" })).toHaveClass("button-danger-solid");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    language();
    expect(screen.getByRole("dialog", { name: `¿Eliminar ${course.title}?` })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Eliminar" });
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mocks.remove).toHaveBeenCalledWith("course-a");
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    // O cartão trava o próprio "Eliminar" enquanto apaga, como os vizinhos.
    expect(within(screen.getByRole("article")).getByRole("button", { name: "Eliminar" })).toBeDisabled();
    language();
    await act(async () => finish());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Course permanently deleted.");
    language();
    expect(screen.getByRole("status")).toHaveTextContent("Curso eliminado de forma permanente.");
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["published", "Retirar de publicación", "inactive", "Unpublished by SkillsetMind admin."],
    ["inactive", "Volver a publicar", "published", null],
  ] as const)("keeps the %s status action and audit note canonical", async (status, button, next, note) => {
    render(panel());
    deliver([{ ...course, status }]);
    language();
    fireEvent.click(screen.getByRole("button", { name: button }));
    // Retirar do ar pergunta antes; publicar de novo segue direto.
    if (status === "published") {
      vi.advanceTimersByTime(CONFIRM_GUARD_MS);
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: button }));
    }
    expect(await screen.findByRole("status")).toHaveTextContent(/Curso/);
    expect(mocks.review).toHaveBeenCalledWith("course-a", next, note);
    expect(mocks.review).toHaveBeenCalledTimes(1);
  });

  it("asks before unpublishing, names the course, and cancel changes nothing", async () => {
    let finish!: () => void;
    mocks.review.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(panel());
    deliver();
    const unpublish = screen.getByRole("button", { name: "Unpublish" });
    expect(unpublish).toHaveClass("button-danger");
    // Os botões do cartão guardam as duas faces (repouso e espera com o anel)
    // na mesma célula: o que gira não empurra os vizinhos.
    for (const button of within(screen.getByRole("article")).getAllByRole("button")) {
      expect(button.querySelectorAll('[class*="grid-area"]')).toHaveLength(2);
    }
    fireEvent.click(unpublish);
    const dialog = screen.getByRole("dialog", { name: `Unpublish ${course.title}?` });
    expect(dialog).toHaveClass("modal-panel");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.review).not.toHaveBeenCalled();
    fireEvent.click(unpublish);
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Unpublish" });
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    // Duplo clique: grava uma vez e a janela segue aberta, sem soltar o 2º clique no "Feature" de baixo.
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    // Só o botão apertado gira; os vizinhos travam com o próprio nome.
    const card = screen.getByRole("article");
    expect(within(card).getByRole("button", { name: "Unpublish" })).toHaveAttribute("aria-busy", "true");
    expect(within(card).getByRole("button", { name: "Unpublish" })).toBe(unpublish);
    expect(within(card).getByRole("button", { name: "Feature" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Feature" })).not.toHaveAttribute("aria-busy");
    await act(async () => finish());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.review).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("keeps featured=%s canonical and does not translate course content", async featured => {
    render(panel());
    deliver([{ ...course, featured }]);
    language();
    fireEvent.click(screen.getByRole("button", { name: featured ? "Quitar destacado" : "Destacar" }));
    await screen.findByRole("status");
    expect(mocks.feature).toHaveBeenCalledWith("course-a", !featured);
    expect(within(screen.getByRole("article")).getByText(course.title)).toBeInTheDocument();
  });

  it("translates a refused delete without showing success or a provider error", async () => {
    mocks.remove.mockRejectedValue(new Error("Private constraint detail"));
    render(panel());
    deliver();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Courses with enrollments or orders must be unpublished instead.");
    language();
    expect(screen.getByRole("alert")).toHaveTextContent("Los cursos con inscripciones o pedidos deben retirarse de publicación.");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Private constraint detail")).toBeNull();
  });
});
