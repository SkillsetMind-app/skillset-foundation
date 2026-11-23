import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherEventStudio } from "@/components/teacher/teacher-event-studio";
import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";
import { formatEventDateTime, formatEventTimeInZones, US_PREVIEW_TIME_ZONES, type CourseEvent } from "@/domain/course-event";
import {
  cancelCourseEvent,
  createCourseEvent,
  deleteCourseEvent,
  subscribeToCourseEventRsvps,
  updateCourseEvent,
} from "@/lib/data/course-events";

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
  productFormat: undefined as string | undefined,
  // A primeira leitura da agenda falha; o "Try again" le de novo pelo canal.
  eventsFail: false,
  reload: vi.fn(),
  // O canal ao vivo: uma releitura posterior que falha chega por aqui.
  failLater: null as ((error: Error) => void) | null,
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
        productFormat: agenda.productFormat,
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
  subscribeToTeacherCourseEvents: (
    _ownerId: string,
    onData: (events: CourseEvent[]) => void,
    onError: (error: Error) => void,
  ) => {
    agenda.failLater = onError;
    if (agenda.eventsFail) onError(new Error("agenda down"));
    else onData(agenda.events);
    return Object.assign(vi.fn(), { reload: agenda.reload });
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
    agenda.productFormat = undefined;
    agenda.eventsFail = false;
    vi.clearAllMocks();
  });

  // Leitura que falhou nao e agenda vazia: nada de "No sessions" com o convite
  // a marcar uma, nem "0" nos quadros. Fica o erro e o "Try again".
  it("agenda que nao carregou mostra o erro e Try again, nunca o vazio", async () => {
    agenda.eventsFail = true;
    agenda.params = "";
    render(<TeacherEventStudio />);

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load your scheduled sessions.");
    expect(screen.queryByText("No sessions in this view.")).toBeNull();
    expect(screen.getAllByText("—")).toHaveLength(3);
    // Exportar desligado diz que a leitura falhou, nao "nada para exportar".
    const exportButton = screen.getByRole("button", { name: "Export" });
    expect(exportButton).toBeDisabled();
    expect(exportButton).toHaveAccessibleDescription("Export is off because this data could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(agenda.reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loading scheduled sessions...")).toBeInTheDocument();
  });

  // Releitura que falha com a agenda na tela: as sessoes ficam, o aviso sobe e
  // o "Try again" vem antes da lista (sem voltar ao "carregando").
  it("releitura que falha mantem as sessoes na tela, com Try again", async () => {
    agenda.params = "";
    agenda.events = [{
      id: "event-kept", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
      ownerId: "teacher-1", title: "Kept session", description: "Still here.",
      type: "live_class", status: "scheduled", startsAt: "2027-03-14T15:30:00.000Z",
      externalUrl: "https://meet.example.com/live", recordingAssetId: null,
    }] as CourseEvent[];
    render(<TeacherEventStudio />);
    expect(await screen.findByText("Kept session")).toBeInTheDocument();

    act(() => agenda.failLater?.(new Error("re-read down")));

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your scheduled sessions.");
    expect(screen.getByText("Kept session")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(agenda.reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Kept session")).toBeInTheDocument();
    expect(screen.queryByText("Loading scheduled sessions...")).toBeNull();
  });

  // Data e hora em dois campos, como na criacao do produto "Live event".
  function fillWhen(date: string, time: string) {
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: date } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: time } });
  }

  async function scheduleSession() {
    fillWhen("2027-03-14", "15:30");
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
    // O quadro ja diz "Session scheduled": a linha de confirmacao nao repete.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

  // Evento ao vivo publica sem aula (20261007010000): nada de aula de boas-vindas.
  it("evento ao vivo: o proximo passo e so preco e publicar, sem aula", async () => {
    agenda.productFormat = "live_event";
    render(<TeacherEventStudio />);
    await scheduleSession();

    const next = await screen.findByRole("region", { name: "Session scheduled. Next: set the price and publish." });
    expect(within(next).getByRole("link", { name: "Set the price and publish" })).toBeInTheDocument();
    expect(within(next).queryByText(/Publishing needs at least one lesson with content/)).not.toBeInTheDocument();
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
    // O formulario fechava sem nenhuma frase: agora diz que deu certo.
    expect(screen.getByRole("status")).toHaveTextContent("Session scheduled.");
  });

  it("does not silently schedule against another course when the requested course is unavailable", async () => {
    agenda.params = "courseId=deleted-course&newEvent=1";
    render(<TeacherEventStudio />);
    const course = screen.getByRole("combobox", { name: "Course" });
    expect(course).toHaveValue("");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fillWhen("2027-03-14", "15:30");
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
    const date = screen.getByLabelText("Date");
    const form = date.closest("form")!;
    fireEvent.submit(form);
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
    expect(createCourseEvent).not.toHaveBeenCalled();
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Session details" })).toHaveFocus();
    expect(screen.queryByLabelText("Date")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Live workshop" } });
    fireEvent.change(screen.getByLabelText("External class link"), { target: { value: "https://meet.example.com/live" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Practical exercises together." } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Date")).toHaveValue("2027-03-14");
    expect(screen.getByLabelText("Time")).toHaveValue("15:30");
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
    expect(screen.getByRole("status")).toHaveTextContent("Session updated.");
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
      formatEventDateTime(startsAt, "es"),
    )).toBeInTheDocument();
    expect(screen.getByText("Fecha pendiente")).toBeInTheDocument();
  });

  // A professora digitava "7:00 PM" sem saber de quem era a hora, e os alunos
  // estao em varios fusos dos EUA.
  it("diz de quem e a hora e mostra a previa nos quatro fusos dos EUA antes de salvar", () => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    const zone = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
      this: Intl.DateTimeFormat,
    ) {
      return { ...real.call(this), timeZone: "America/Chicago" };
    });
    render(<TeacherEventStudio />);

    // O nome do fuso, com a cidade do id so entre parenteses: quem mora em
    // Dallas nao le "Chicago" como se fosse o lugar dela.
    const line = "Time zone: Central Time (Chicago), from this computer";
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveAccessibleDescription(line);
    expect(screen.getByLabelText("Time")).toHaveAccessibleDescription(line);
    // Campos maiores, com o teclado certo de cada um.
    expect(screen.getByLabelText("Date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Time")).toHaveAttribute("type", "time");
    expect(screen.getByLabelText("Date")).toHaveClass("min-h-12", "text-base");
    zone.mockRestore();

    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const instant = new Date("2027-03-14T15:30").toISOString();
    const preview = screen.getByText(/^In US time zones: /);
    expect(preview.textContent).toBe(
      `In US time zones: ${formatEventTimeInZones(instant, "en", US_PREVIEW_TIME_ZONES).join(" · ")}`,
    );
    expect(preview.textContent?.replace(/\s+/g, " ")).toMatch(/ ET · .+ CT · .+ MT · .+ PT$/);
  });

  it("data e hora que ja passaram travam antes de salvar, com a frase ligada aos campos", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 2, 14, 12, 0));
    try {
      render(<TeacherEventStudio />);
      fillWhen("2027-03-14", "09:00");
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
      const date = screen.getByLabelText("Date");
      expect(date).toHaveAttribute("aria-invalid", "true");
      expect(date).toHaveAccessibleDescription(/Choose a date and time that has not passed yet\./);
      expect(screen.getByLabelText("Time")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(date).toHaveAttribute("min", "2027-03-14");

      fireEvent.change(screen.getByLabelText("Time"), { target: { value: "13:00" } });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      expect(screen.getByLabelText("Session title")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Prazo nao e reuniao: pedir um link de Zoom para ele nao fazia sentido.
  it("prazo (Deadline) salva sem link; os outros tipos continuam pedindo", async () => {
    render(<TeacherEventStudio />);
    fireEvent.change(screen.getByRole("combobox", { name: "Session type" }), { target: { value: "deadline" } });
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const link = screen.getByLabelText("External class link");
    expect(link).not.toBeRequired();
    expect(link).toHaveAccessibleDescription("Optional for a deadline: it is a due date, not a meeting.");
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Final essay due" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Send the essay before this time." } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule session" }));
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "deadline", externalUrl: "" })));

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("External class link")).toBeRequired();
  });

  it("o link abre o teclado de endereco e ganha o https:// que faltava ao sair do campo", async () => {
    render(<TeacherEventStudio />);
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const link = screen.getByLabelText("External class link");
    // Sem type="url": a validacao do navegador barraria "zoom.us/j/123" antes
    // do https:// do envio. O teclado de endereco vem do inputmode.
    expect(link).not.toHaveAttribute("type", "url");
    expect(link).toHaveAttribute("inputmode", "url");
    expect(link).toHaveAttribute("autocapitalize", "none");
    expect(link).toHaveAttribute("autocorrect", "off");
    expect(link).toHaveAttribute("spellcheck", "false");
    fireEvent.change(link, { target: { value: "zoom.us/j/123" } });
    fireEvent.blur(link);
    expect(link).toHaveValue("https://zoom.us/j/123");
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Live workshop" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Practical exercises together." } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule session" }));
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledWith(expect.objectContaining({ externalUrl: "https://zoom.us/j/123" })));
  });

  // Enter no campo (ou o toque no iOS que nao tira o foco) envia sem blur: o
  // https:// entra no envio mesmo assim.
  it("link sem esquema enviado com Enter, sem sair do campo, grava com https://", async () => {
    render(<TeacherEventStudio />);
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Live workshop" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Practical exercises together." } });
    const link = screen.getByLabelText("External class link");
    fireEvent.change(link, { target: { value: "zoom.us/j/456" } });
    fireEvent.submit(link.closest("form")!);
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledWith(expect.objectContaining({ externalUrl: "https://zoom.us/j/456" })));
  });

  // A sessao criada junto com o produto nasce com descricao vazia: a
  // professora que so quer pôr o link nao pode ser barrada pelas 12 letras.
  it("sessao que ja tinha descricao vazia salva so com o link; sessao nova exige a descricao", async () => {
    agenda.params = "";
    agenda.events = [{
      id: "event-bare", courseId: "event-product-1", courseSlug: "event-product-1", courseTitle: "Live supervision intensive",
      ownerId: "teacher-1", title: "Live supervision intensive", description: "",
      type: "live_class", status: "scheduled", startsAt: "2027-03-14T15:30:00.000Z",
      externalUrl: "", recordingAssetId: null,
    }];
    render(<TeacherEventStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Session description")).not.toBeRequired();
    fireEvent.change(screen.getByLabelText("External class link"), { target: { value: "https://meet.example.com/live" } });
    fireEvent.click(screen.getByRole("button", { name: "Update session" }));
    await waitFor(() => expect(updateCourseEvent).toHaveBeenCalledWith("event-bare", expect.objectContaining({
      description: "", externalUrl: "https://meet.example.com/live",
    })));

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Session description")).toBeRequired();
  });

  // Grupo semanal: digitava tudo de novo a cada semana.
  it("agendar outra igual abre o formulario preenchido uma semana depois e so grava ao confirmar", async () => {
    agenda.params = "";
    agenda.events = [{
      id: "event-weekly", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
      ownerId: "teacher-1", title: "Weekly group", description: "Our weekly group call.",
      type: "mentorship", status: "scheduled", startsAt: new Date(2027, 2, 14, 15, 30).toISOString(),
      externalUrl: "https://meet.example.com/weekly", recordingAssetId: null,
    }];
    render(<TeacherEventStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule another like this" }));

    expect(screen.getByRole("combobox", { name: "Course" })).toHaveValue("course-1");
    expect(screen.getByRole("combobox", { name: "Course" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Session type" })).toHaveValue("mentorship");
    expect(screen.getByLabelText("Date")).toHaveValue("2027-03-21");
    expect(screen.getByLabelText("Time")).toHaveValue("15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Session title")).toHaveValue("Weekly group");
    expect(screen.getByLabelText("External class link")).toHaveValue("https://meet.example.com/weekly");
    expect(screen.getByLabelText("Session description")).toHaveValue("Our weekly group call.");
    expect(createCourseEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Schedule session" }));
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledWith(expect.objectContaining({
      courseId: "course-1", type: "mentorship", title: "Weekly group",
      startsAt: new Date(2027, 2, 21, 15, 30).toISOString(),
    })));
    expect(updateCourseEvent).not.toHaveBeenCalled();
  });

  it("copiada de uma sessao antiga, a proxima cai na primeira semana que ainda nao passou", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 2, 30, 12, 0));
    try {
      agenda.params = "";
      agenda.events = [{
        id: "event-old", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
        ownerId: "teacher-1", title: "Weekly group", description: "Our weekly group call.",
        type: "mentorship", status: "scheduled", startsAt: new Date(2027, 2, 14, 15, 30).toISOString(),
        externalUrl: "https://meet.example.com/weekly", recordingAssetId: null,
      }];
      render(<TeacherEventStudio />);
      fireEvent.change(screen.getByLabelText("Filter sessions"), { target: { value: "past" } });
      fireEvent.click(screen.getByRole("button", { name: "Schedule another like this" }));
      expect(screen.getByLabelText("Date")).toHaveValue("2027-04-04");
      expect(screen.getByLabelText("Time")).toHaveValue("15:30");
    } finally {
      vi.useRealTimers();
    }
  });

  // F-14: cancelar e excluir abriam a caixa cinza do navegador ("OK /
  // Cancel") e, depois de excluir, nada dizia que tinha dado certo.
  describe("cancelar e excluir perguntam na janela da plataforma", () => {
    const session: CourseEvent = {
      id: "event-live", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
      ownerId: "teacher-1", title: "Live $& session", description: "", type: "live_class",
      status: "scheduled", startsAt: "2027-03-14T15:30:00.000Z",
      externalUrl: "https://meet.example.com/live", recordingAssetId: null,
    };
    // O jsdom não tem showModal/close: o stub faz o mínimo que o navegador faz.
    const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
    const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

    beforeEach(() => {
      agenda.params = "";
      agenda.events = [session];
      // Só o Date é falso: o confirmar ignora cliques nos primeiros 500ms.
      vi.useFakeTimers({ toFake: ["Date"] });
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
      Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
    });
    afterEach(() => {
      vi.useRealTimers();
      if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
      if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    });

    it.each([
      {
        trigger: "Cancel session", title: "Cancel this session?", confirm: "Cancel session", action: cancelCourseEvent,
        // A frase diz o que e verdade: o aluno ve a sessao marcada como
        // cancelada por uma semana, e ninguem e avisado sozinho.
        sentence: "Cancel \"Live $& session\"? Learners see it marked as cancelled in their agenda for a week. They are not notified automatically, so let them know.", notice: "Session cancelled.",
      },
      {
        trigger: "Delete", title: "Delete this session?", confirm: "Delete session", action: deleteCourseEvent,
        sentence: "Permanently delete \"Live $& session\"? This cannot be undone.", notice: "Session deleted.",
      },
    ])("$trigger: mostra a frase, nada acontece sem confirmar e confirmar roda uma vez", async ({ trigger, title, confirm, action, sentence, notice }) => {
      const nativeConfirm = vi.spyOn(window, "confirm");
      vi.mocked(action).mockResolvedValue(undefined);
      render(<TeacherEventStudio />);

      // (a) a frase de sempre, agora na janela da plataforma;
      fireEvent.click(screen.getByRole("button", { name: trigger }));
      const dialog = screen.getByRole("dialog", { name: title });
      expect(dialog).toHaveTextContent(sentence);
      expect(nativeConfirm).not.toHaveBeenCalled();
      // (b) desistir não faz nada;
      fireEvent.click(within(dialog).getByRole("button", { name: "Keep session" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(action).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      // (c) confirmar chama a ação uma vez, com a mesma sessão. O clique
      // colado na abertura (toque duplo) é descartado.
      fireEvent.click(screen.getByRole("button", { name: trigger }));
      const again = screen.getByRole("dialog", { name: title });
      fireEvent.click(within(again).getByRole("button", { name: confirm }));
      expect(action).not.toHaveBeenCalled();
      vi.advanceTimersByTime(CONFIRM_GUARD_MS);
      fireEvent.click(within(again).getByRole("button", { name: confirm }));
      expect(action).toHaveBeenCalledExactlyOnceWith("event-live");
      // e diz que deu certo.
      expect(await screen.findByRole("status")).toHaveTextContent(notice);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(action).toHaveBeenCalledOnce();
      nativeConfirm.mockRestore();
    });

    it("o aviso de sucesso some quando a pessoa volta a mexer na agenda", async () => {
      render(<TeacherEventStudio />);
      fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
      vi.advanceTimersByTime(CONFIRM_GUARD_MS);
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel session" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Session cancelled.");

      // Editar outra coisa: o "Session cancelled." antigo não fica ao lado do
      // formulário (nem de um erro novo dele).
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    // Nome e e-mail ja chegavam na leitura das respostas, mas a tela so
    // mostrava "3 going". E excluir apagava as respostas sem dizer nada.
    it("mostra quem respondeu, exporta nome, e-mail e resposta, e excluir diz quantos perdem a resposta", async () => {
      const rsvp = { eventId: "event-live", courseSlug: "course-1", userId: "u" };
      vi.mocked(subscribeToCourseEventRsvps).mockImplementationOnce((_eventId, onData) => {
        onData([
          { ...rsvp, id: "r1", attendeeName: "Ana Lima", attendeeEmail: "ana@example.com", status: "attending" },
          { ...rsvp, id: "r2", attendeeName: "Bruno", attendeeEmail: null, status: "not_attending" },
          { ...rsvp, id: "r3", attendeeName: "Carla", attendeeEmail: "carla@example.com", status: "attending" },
        ]);
        return vi.fn();
      });
      const created: Blob[] = [];
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { created.push(blob); return "blob:x"; } });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
      render(<TeacherEventStudio />);

      expect(screen.getByText("2 going")).toBeInTheDocument();
      const answers = screen.getByText("See who answered").closest("details")!;
      fireEvent.click(screen.getByText("See who answered"));
      // Quem vai primeiro, depois quem nao vai.
      expect(within(answers).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
        "Ana Lima · Going",
        "Carla · Going",
        "Bruno · Not going",
      ]);
      const group = within(answers).getByRole("group", { name: "Export attendees" });
      fireEvent.click(within(group).getByRole("button", { name: "Export" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Export as CSV" }));
      expect(created).toHaveLength(1);
      const csv = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(created[0]);
      });
      expect(csv).toBe(
        "name,email,answer\nAna Lima,ana@example.com,Going\nCarla,carla@example.com,Going\nBruno,,Not going",
      );

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByRole("dialog", { name: "Delete this session?" })).toHaveTextContent(
        "2 people said they will attend. Deleting erases their answers and nobody is notified. Cancel session keeps the record instead.",
      );
      click.mockRestore();
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    });

    it("quando excluir falha, o erro aparece onde já aparecia e não há aviso de sucesso", async () => {
      vi.mocked(deleteCourseEvent).mockRejectedValueOnce(new Error("Delete unavailable"));
      render(<TeacherEventStudio />);

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      vi.advanceTimersByTime(CONFIRM_GUARD_MS);
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete session" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("We could not delete this session.");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(deleteCourseEvent).toHaveBeenCalledOnce();
    });
  });

  // A hora repetida de novembro: 09:30Z em 1/nov/2026 e 1:30 AM PST em Los
  // Angeles, e "01:30" relido vira 1:30 AM PDT (08:30Z). Editar so o titulo
  // salvava a sessao uma hora antes. Fica por ultimo no arquivo: o fuso do
  // processo muda.
  it("editar sem mexer na data devolve o instante gravado, mesmo na hora repetida de novembro", async () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    try {
      expect(new Date("2026-11-01T09:30:00.000Z").getTimezoneOffset()).toBe(480);
      agenda.params = "";
      agenda.events = [{
        id: "event-dst", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
        ownerId: "teacher-1", title: "Early bird", description: "A very early session.",
        type: "live_class", status: "scheduled", startsAt: "2026-11-01T09:30:00.000Z",
        externalUrl: "https://meet.example.com/live", recordingAssetId: null,
      }];
      render(<TeacherEventStudio />);
      fireEvent.change(screen.getByLabelText("Filter sessions"), { target: { value: "all" } });
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(screen.getByLabelText("Time")).toHaveValue("01:30");
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Early bird club" } });
      fireEvent.click(screen.getByRole("button", { name: "Update session" }));
      await waitFor(() => expect(updateCourseEvent).toHaveBeenCalledWith("event-dst", expect.objectContaining({
        title: "Early bird club", startsAt: "2026-11-01T09:30:00.000Z",
      })));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
