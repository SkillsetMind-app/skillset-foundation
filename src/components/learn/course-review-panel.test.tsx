import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CourseReviewPanel } from "@/components/learn/course-review-panel";
import type { CourseReview } from "@/domain/course-review";
import { submitCourseReview, subscribeToUserCourseReview } from "@/lib/data/course-reviews";

const mocks = vi.hoisted(() => ({
  user: { uid: "student-test" } as { uid: string } | null,
  review: null as CourseReview | null,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/course-reviews", () => ({
  submitCourseReview: vi.fn(),
  subscribeToUserCourseReview: vi.fn(),
}));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

function renderReview(overrides: Partial<Parameters<typeof CourseReviewPanel>[0]> = {}, locale: "en" | "es" = "es") {
  return render(<I18nProvider initialLocale={locale}><ChangeLanguage />
    <CourseReviewPanel courseId="course-test" progressPercent={50} {...overrides} />
  </I18nProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user = { uid: "student-test" };
  mocks.review = null;
  vi.mocked(subscribeToUserCourseReview).mockImplementation((_courseId, _userId, onNext) => {
    onNext(mocks.review);
    return vi.fn();
  });
});

describe("CourseReviewPanel locale and state", () => {
  it("keeps rating, body and focus when translating and waits for the same pending submission", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof submitCourseReview>>) => void;
    vi.mocked(submitCourseReview).mockReturnValue(new Promise((done) => { resolve = done; }));
    renderReview({}, "en");
    const body = "Useful notes $$50 $& — contenido original";
    const field = screen.getByRole("textbox", { name: "Your review" });
    fireEvent.change(field, { target: { value: body } });
    fireEvent.click(screen.getByRole("radio", { name: "3 stars" }));
    field.focus();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("textbox", { name: "Tu reseña" })).toBe(field);
    expect(field).toHaveFocus();
    expect(field).toHaveValue(body);
    expect(screen.getByRole("radio", { name: "3 estrellas" })).toHaveAttribute("aria-checked", "true");
    expect(subscribeToUserCourseReview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Enviar reseña" }));
    expect(screen.getByRole("button", { name: "Guardando..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(field).toHaveValue(body);
    expect(screen.queryByText(/Review saved/)).not.toBeInTheDocument();
    expect(submitCourseReview).toHaveBeenCalledExactlyOnceWith({ courseId: "course-test", rating: 3, body });
    await act(async () => resolve({ success: true, reviewId: "review-test", ratingAverage: 3, ratingCount: 1 }));
    expect(screen.getByText("Review saved. Thank you for rating this course.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("Reseña guardada. Gracias por valorar este curso.")).toBeInTheDocument();
    expect(field).toHaveValue(body);
    expect(submitCourseReview).toHaveBeenCalledTimes(1);
  });

  it("localizes an existing review without replacing an edited draft from a new subscription", () => {
    mocks.review = { id: "review-test", courseId: "course-test", rating: 4, body: "Original $$ $&" } as CourseReview;
    renderReview({}, "en");
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "Unsaved $$ $&" } });
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: "Actualizar reseña" })).toBeInTheDocument();
    expect(field).toHaveValue("Unsaved $$ $&");
    expect(screen.getByRole("radio", { name: "4 estrellas" })).toHaveAttribute("aria-checked", "true");
    expect(subscribeToUserCourseReview).toHaveBeenCalledTimes(1);
    expect(submitCourseReview).not.toHaveBeenCalled();
  });

  it.each([
    { progressPercent: 49, previewMode: false, signedIn: true, reason: "Las reseñas se habilitan al completar el 50% del curso." },
    { progressPercent: 100, previewMode: true, signedIn: true, reason: "La vista previa no permite publicar reseñas del curso." },
    { progressPercent: 100, previewMode: false, signedIn: false, reason: "Inicia sesión para reseñar este curso." },
  ])("preserves the review gate in Spanish: $reason", ({ signedIn, reason, ...props }) => {
    if (!signedIn) mocks.user = null;
    renderReview(props);
    const button = screen.getByRole("button", { name: "Enviar reseña" });
    expect(button).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Tu reseña" })).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
    fireEvent.submit(button.closest("form")!);
    expect(submitCourseReview).not.toHaveBeenCalled();
  });

  it.each([
    ["Sign in before reviewing a course.", "Inicia sesión para reseñar este curso."],
    ["Enroll in this course before leaving a review.", "Inscríbete en este curso antes de publicar una reseña."],
    ["Complete at least 50% of the course before leaving a review.", "Las reseñas se habilitan al completar el 50% del curso."],
    ["Review text must be at least 3 characters when provided.", "Escribe al menos 3 caracteres o deja la reseña sin texto."],
    ["Rating must be between 1 and 5.", "La valoración debe estar entre 1 y 5."],
    ["Course not found.", "No se encontró el curso."],
    ["Only published courses can receive reviews.", "Solo los cursos publicados pueden recibir reseñas."],
    ["You can only review courses attached to your account.", "Solo puedes reseñar cursos vinculados a tu cuenta."],
    ["This enrollment cannot leave a review.", "Esta inscripción no permite publicar reseñas."],
    ["RATE_LIMIT", "Demasiados intentos. Espera antes de volver a intentarlo."],
    ["internal relation private_table stack SQL", "No pudimos guardar tu reseña. Inténtalo de nuevo."],
  ])("localizes a rejected submission without losing its cause or exposing internals: %s", async (message, expected) => {
    vi.mocked(submitCourseReview).mockRejectedValue({ code: "P0001", message });
    renderReview();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Draft $$ $&" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar reseña" })); });
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Draft $$ $&");
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reseña guardada/)).not.toBeInTheDocument();
    expect(submitCourseReview).toHaveBeenCalledTimes(1);
  });

  it("relocalizes a stored load error without reloading the review", () => {
    vi.mocked(subscribeToUserCourseReview).mockImplementationOnce((_courseId, _userId, _onNext, onError) => {
      onError(new Error("private detail"));
      return vi.fn();
    });
    renderReview({}, "en");
    expect(screen.getByText("We could not load your course review.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("No pudimos cargar tu reseña del curso.")).toBeInTheDocument();
    expect(subscribeToUserCourseReview).toHaveBeenCalledTimes(1);
    expect(submitCourseReview).not.toHaveBeenCalled();
  });
});
