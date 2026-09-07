import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CourseMessagesPanel } from "@/components/learn/course-messages-panel";
import type { CourseMessage } from "@/domain/course-message";
import { sendCourseMessage, subscribeToCourseThread } from "@/lib/data/course-messages";

const mocks = vi.hoisted(() => ({ user: { uid: "student-test" } as { uid: string } | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/course-messages", () => ({ sendCourseMessage: vi.fn(), subscribeToCourseThread: vi.fn() }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function renderMessages(previewMode = false, locale: "en" | "es" = "es") {
  return render(<I18nProvider initialLocale={locale}><ChangeLanguage />
    <CourseMessagesPanel courseId="course-test" previewMode={previewMode} />
  </I18nProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user = { uid: "student-test" };
  vi.mocked(subscribeToCourseThread).mockImplementation((_course, _student, onNext) => {
    onNext([]);
    return vi.fn();
  });
});

describe("private course messages in the current locale", () => {
  it("keeps the thread, draft and focus through locale changes and waits for the original send", async () => {
    vi.mocked(subscribeToCourseThread).mockImplementationOnce((_course, _student, onNext) => {
      onNext([{ id: "message-test", senderId: "teacher-test", body: "Original $$ $&", createdAt: new Date().toISOString() } as CourseMessage]);
      return vi.fn();
    });
    let resolve!: (value: Awaited<ReturnType<typeof sendCourseMessage>>) => void;
    vi.mocked(sendCourseMessage).mockReturnValue(new Promise((done) => { resolve = done; }));
    renderMessages(false, "en");
    const field = screen.getByRole("textbox", { name: "Your private message" });
    const body = "A private question $$50 $&";
    fireEvent.change(field, { target: { value: body } });
    field.focus();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("textbox", { name: "Tu mensaje privado" })).toBe(field);
    expect(field).toHaveFocus();
    expect(field).toHaveValue(body);
    expect(screen.getByText("Original $$ $&")).toBeInTheDocument();
    expect(screen.getByText(/Instructor · Ahora mismo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    expect(screen.getByRole("button", { name: "Enviando..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
    expect(field).toHaveValue(body);
    expect(subscribeToCourseThread).toHaveBeenCalledTimes(1);
    expect(sendCourseMessage).toHaveBeenCalledExactlyOnceWith({ courseId: "course-test", studentId: "student-test", body });
    await act(async () => resolve({ success: true, messageId: "new-test" }));
    expect(field).toHaveValue("");
    expect(sendCourseMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    [true, true, "La vista previa no permite enviar mensajes."],
    [false, false, "Inicia sesión para escribir a tu instructor."],
  ])("keeps the send gate in Spanish (preview=%s, signed in=%s)", (preview, signedIn, reason) => {
    if (!signedIn) mocks.user = null;
    renderMessages(preview);
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
    const send = screen.getByRole("button", { name: "Enviar mensaje" });
    expect(send).toBeDisabled();
    fireEvent.submit(send.closest("form")!);
    expect(sendCourseMessage).not.toHaveBeenCalled();
    expect(subscribeToCourseThread).not.toHaveBeenCalled();
  });

  it.each([
    ["Sign in before sending a message.", "Inicia sesión para escribir a tu instructor."],
    ["Message cannot be empty.", "Escribe un mensaje antes de enviarlo."],
    ["Only enrolled students can use course messages.", "Inscríbete en este curso para usar los mensajes."],
    ["You can only send messages in your own thread.", "Solo puedes enviar mensajes en tu propia conversación."],
    ["This enrollment does not match the thread.", "Esta inscripción no corresponde a la conversación."],
    ["This enrollment cannot send messages.", "Esta inscripción no permite enviar mensajes."],
    ["RATE_LIMIT", "Demasiados intentos. Espera antes de volver a intentarlo."],
    ["private SQL stack table", "No pudimos enviar tu mensaje. Inténtalo de nuevo."],
  ])("localizes a known rejection or a safe fallback: %s", async (message, expected) => {
    vi.mocked(sendCourseMessage).mockRejectedValue({ code: "P0001", message });
    renderMessages();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Draft $$ $&" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" })); });
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Draft $$ $&");
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(sendCourseMessage).toHaveBeenCalledTimes(1);
  });

  it("relocalizes an existing load failure without replacing the draft or subscribing again", () => {
    vi.mocked(subscribeToCourseThread).mockImplementationOnce((_course, _student, _next, error) => {
      error(new Error("private cause"));
      return vi.fn();
    });
    renderMessages(false, "en");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unsent" } });
    expect(screen.getByText("We could not load your messages.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("No pudimos cargar tus mensajes.")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Unsent");
    expect(subscribeToCourseThread).toHaveBeenCalledTimes(1);
  });
});
