import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherEventStudio } from "@/components/teacher/teacher-event-studio";
import type { CourseEvent } from "@/domain/course-event";
import { createCourseEvent, updateCourseEvent } from "@/lib/data/course-events";

const authState = vi.hoisted(() => ({
  user: { uid: "teacher-1", roles: ["teacher"] },
}));
// A agenda que a inscricao entrega; cada teste decide o que ha nela.
const agenda = vi.hoisted(() => ({
  events: [] as CourseEvent[],
  params: "courseId=event-product-1&newEvent=1",
  // Modulos e status do produto de evento: o proximo passo depende deles.
  productModules: [] as Array<Record<string, unknown>>,
  productStatus: "draft",
  productPaymentType: "one_time",
}));

// O I18nProvider chama useRouter() para o refresh ao trocar de idioma.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(agenda.params),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: (
    _ownerId: string,
    onData: (courses: Array<Record<string, unknown>>) => void
  ) => {
    onData([
      {
        id: "course-1",
        ownerId: "teacher-1",
        title: "Existing course",
        summary: "Existing course summary",
        category: "Mental Health Foundations",
        status: "draft",
        modules: [],
        lessonCount: 0,
      },
      {
        id: "event-product-1",
        ownerId: "teacher-1",
        title: "Live supervision intensive",
        summary: "A paid live cohort",
        category: "Supervision & Continuing Education",
        status: agenda.productStatus,
        paymentType: agenda.productPaymentType,
        modules: agenda.productModules,
        lessonCount: 0,
      },
    ]);
    return vi.fn();
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  cancelCourseEvent: vi.fn(),
  createCourseEvent: vi.fn(),
  deleteCourseEvent: vi.fn(),
  subscribeToCourseEventRsvps: vi.fn(() => vi.fn()),
  subscribeToTeacherCourseEvents: (_ownerId: string, onData: (events: CourseEvent[]) => void) => {
    onData(agenda.events);
    return vi.fn();
  },
  updateCourseEvent: vi.fn(),
}));

describe("TeacherEventStudio", () => {
  afterEach(() => {
    agenda.events = [];
    agenda.params = "courseId=event-product-1&newEvent=1";
    agenda.productModules = [];
    agenda.productStatus = "draft";
    agenda.productPaymentType = "one_time";
    vi.clearAllMocks();
  });

  async function scheduleSession() {
    fireEvent.change(screen.getByLabelText("Date and time"), { target: { value: "2027-03-14T15:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Live workshop" } });
    fireEvent.change(screen.getByLabelText("External class link"), { target: { value: "https://meet.example.com/live" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Practical exercises together." } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule session" }));
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledTimes(1));
  }

  // Depois de marcar a sessao a pessoa ficava presa na Agenda, sem caminho
  // para preco e publicacao. O servidor (publish_teacher_course) ainda exige
  // uma aula com conteudo, entao o atalho da aula de boas-vindas vem junto.
  it("depois de marcar a sessao mostra o proximo passo: preco e publicar, com a aula de boas-vindas", async () => {
    render(<TeacherEventStudio />);
    expect(screen.queryByRole("link", { name: "Set the price and publish" })).not.toBeInTheDocument();
    await scheduleSession();

    const next = await screen.findByRole("region", { name: "Session scheduled. Next: set the price and publish." });
    const pricing = within(next).getByRole("link", { name: "Set the price and publish" });
    expect(pricing).toHaveAttribute("href", "/teach/builder?courseId=event-product-1&tab=pricing");
    expect(pricing).toHaveClass("button-solid", "button-lg");
    expect(pricing.querySelector("svg")).not.toBeNull();
    expect(within(next).getByText(/Publishing needs at least one lesson with content/)).toBeInTheDocument();
    const lesson = within(next).getByRole("link", { name: "Add a short welcome lesson" });
    expect(lesson).toHaveAttribute("href", "/teach/builder?courseId=event-product-1&tab=content&welcome=1");
    expect(lesson).toHaveClass("button-outline");
  });

  it("produto que ja tem aula: o proximo passo e so preco e publicar", async () => {
    agenda.productModules = [{ id: "m1", title: "Welcome", lessons: [{ id: "l1", title: "Hello", type: "text", description: "" }] }];
    render(<TeacherEventStudio />);
    await scheduleSession();

    const next = await screen.findByRole("region", { name: "Session scheduled. Next: set the price and publish." });
    expect(within(next).getByRole("link", { name: "Set the price and publish" })).toBeInTheDocument();
    expect(within(next).queryByRole("link", { name: "Add a short welcome lesson" })).not.toBeInTheDocument();
  });

  // Gratis nao tem preco: o atalho mandava para a aba de preco, onde a propria
  // tela pergunta "quer cobrar?". O passo vira so publicar, na revisao.
  it("produto gratis: o proximo passo e publicar, sem falar de preco", async () => {
    agenda.productPaymentType = "free";
    render(<TeacherEventStudio />);
    await scheduleSession();

    const next = await screen.findByRole("region", { name: "Session scheduled. Next: publish." });
    const publish = within(next).getByRole("link", { name: "Review and publish" });
    expect(publish).toHaveAttribute("href", "/teach/builder?courseId=event-product-1&tab=review");
    expect(within(next).queryByRole("link", { name: "Set the price and publish" })).not.toBeInTheDocument();
    expect(within(next).getByRole("link", { name: "Add a short welcome lesson" })).toBeInTheDocument();
  });

  // Em revisao o construtor abre so para leitura: nenhum atalho para la.
  it("produto em revisao: nada de proximo passo", async () => {
    agenda.productStatus = "in_review";
    render(<TeacherEventStudio />);
    await scheduleSession();

    await waitFor(() => expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: /Session scheduled/ })).not.toBeInTheDocument();
  });

  it("produto ja publicado: nada de proximo passo", async () => {
    agenda.productStatus = "published";
    render(<TeacherEventStudio />);
    await scheduleSession();

    await waitFor(() => expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Set the price and publish" })).not.toBeInTheDocument();
  });

  it("does not silently schedule against another course when the requested course is unavailable", async () => {
    agenda.params = "courseId=deleted-course&newEvent=1";
    render(<TeacherEventStudio />);
    const course = screen.getByRole("combobox", { name: "Course" });
    expect(course).toHaveValue("");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Date and time"), { target: { value: "2027-03-14T15:30" } });
    const form = course.closest("form");
    if (!form) throw new Error("Event form not found");
    fireEvent.submit(form);
    await waitFor(() => expect(createCourseEvent).not.toHaveBeenCalled());
    fireEvent.change(course, { target: { value: "event-product-1" } });
    expect(course).toHaveValue("event-product-1");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("still defaults to the first course when no course was requested", () => {
    agenda.params = "newEvent=1";
    render(<TeacherEventStudio />);
    expect(screen.getByRole("combobox", { name: "Course" })).toHaveValue("course-1");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("reveals details only after a valid date, preserves both steps, and saves only at the end", async () => {
    render(<TeacherEventStudio />);
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
    const date = screen.getByLabelText("Date and time");
    const form = date.closest("form")!;
    fireEvent.submit(form);
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
    expect(createCourseEvent).not.toHaveBeenCalled();
    fireEvent.change(date, { target: { value: "2027-03-14T15:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Session details" })).toHaveFocus();
    expect(screen.queryByLabelText("Date and time")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Live workshop" } });
    fireEvent.change(screen.getByLabelText("External class link"), { target: { value: "https://meet.example.com/live" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Practical exercises together." } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Date and time")).toHaveValue("2027-03-14T15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Session title")).toHaveValue("Live workshop");
    expect(createCourseEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Schedule session" }));
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledTimes(1));
    expect(createCourseEvent).toHaveBeenCalledWith(expect.objectContaining({
      courseId: "event-product-1", title: "Live workshop", externalUrl: "https://meet.example.com/live",
      startsAt: new Date("2027-03-14T15:30").toISOString(),
    }));
    await waitFor(() => expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument());
  });

  it("preselects the product created by the event workflow", async () => {
    render(<TeacherEventStudio />);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Course" })).toHaveValue("event-product-1");
    });
  });

  it("keeps edit values and failed saves on the details step for retry", async () => {
    agenda.params = "";
    agenda.events = [{
      id: "event-edit", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
      ownerId: "teacher-1", title: "Existing session", description: "An existing description.",
      type: "live_class", status: "scheduled", startsAt: "2027-03-14T15:30:00.000Z",
      externalUrl: "https://meet.example.com/live", recordingAssetId: null,
    }];
    vi.mocked(updateCourseEvent).mockRejectedValueOnce(new Error("Save unavailable"));
    render(<TeacherEventStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("combobox", { name: "Course" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Session title")).toHaveValue("Existing session");
    fireEvent.click(screen.getByRole("button", { name: "Update session" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Session title")).toHaveValue("Existing session");
    expect(createCourseEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update session" }));
    await waitFor(() => expect(updateCourseEvent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument());
  });

  // O estudio inteiro ainda fala ingles; so a data passou a seguir o idioma da
  // pessoa, e a data invalida mostra o texto traduzido em vez de "Date pending".
  it("na agenda, a data da sessao sai no idioma da pessoa e data invalida vira 'Fecha pendiente'", async () => {
    // Data no futuro: a agenda abre no filtro "Upcoming", entao uma sessao
    // passada nao estaria na lista. O que este teste prova (data no idioma da
    // pessoa e o fallback da data invalida) nao muda com isso.
    const startsAt = "2027-03-14T15:30:00.000Z";
    const base = {
      courseId: "course-1",
      courseSlug: "existing-course",
      courseTitle: "Existing course",
      ownerId: "teacher-1",
      description: "",
      type: "live_class" as const,
      status: "scheduled" as const,
      externalUrl: "https://meet.example.com/live",
      recordingAssetId: null,
    };
    agenda.events = [
      { ...base, id: "event-1", title: "Live Q&A", startsAt },
      { ...base, id: "event-2", title: "Sin fecha", startsAt: "not a date" },
    ];
    render(<I18nProvider initialLocale="es"><TeacherEventStudio /></I18nProvider>);

    expect(await screen.findByText(
      new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(startsAt)),
    )).toBeInTheDocument();
    expect(screen.getByText("Fecha pendiente")).toBeInTheDocument();
  });
});
