import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LearnEventsHub } from "@/components/learn/learn-events-hub";
import { formatEventDateTime, type CourseEvent } from "@/domain/course-event";
import type { Enrollment } from "@/domain/enrollment";

// O MESMO usuario em todo render: a inscricao das matriculas depende de
// `user`, e um objeto novo a cada render reinscreveria em laco.
const mocks = vi.hoisted(() => {
  const startsAt = "2026-03-14T15:30:00.000Z";
  const base = {
    courseId: "course-1",
    courseSlug: "demo-course",
    courseTitle: "Demo course",
    ownerId: "teacher-1",
    description: "",
    type: "live_class" as const,
    status: "scheduled" as const,
    externalUrl: "https://meet.example.com/live",
    recordingAssetId: null,
  };
  const enrollment: Enrollment = {
    id: "enrollment-1",
    userId: "student-1",
    courseId: "course-1",
    courseSlug: "demo-course",
    courseTitle: "Demo course",
    courseCategory: "Applied Psychology & Behavior",
    courseImage: "",
    status: "active",
    source: "payment",
    progressPercent: 0,
    lastLessonId: null,
  };
  const events: CourseEvent[] = [
    { ...base, id: "event-1", title: "Live Q&A", startsAt },
    { ...base, id: "event-2", title: "Sin fecha", startsAt: "not a date" },
  ];
  return {
    user: { uid: "student-1", roles: ["student"] }, startsAt, enrollment, events, base,
    rsvp: null as { status: "attending" | "not_attending" } | null,
    // Os eventos que abriram um canal de presenca.
    rsvpEvents: [] as string[],
    // A opcao com que a agenda le as sessoes.
    options: undefined as unknown,
    enrollments: null as Enrollment[] | null,
  };
});

// O I18nProvider chama useRouter() para o refresh ao trocar de idioma.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => router,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToUserEnrollments: (_uid: string, onData: (rows: Enrollment[]) => void) => {
    onData(mocks.enrollments ?? [mocks.enrollment]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: (
    _slug: string,
    onData: (events: CourseEvent[]) => void,
    _onError: unknown,
    options?: unknown,
  ) => {
    mocks.options = options;
    // Em ordem de inicio, como a fonte devolve.
    onData([...mocks.events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
    return () => undefined;
  },
  subscribeToCourseEventRsvp: (eventId: string, _uid: string, onData: (rsvp: unknown) => void) => {
    mocks.rsvpEvents.push(eventId);
    onData(mocks.rsvp);
    return () => undefined;
  },
  saveCourseEventRsvp: vi.fn(),
}));

// O hub inteiro ainda fala ingles; so a data passou a seguir o idioma da
// pessoa, e a data invalida mostra o texto traduzido em vez de "Date pending".
describe("LearnEventsHub", () => {
  it("a data de cada sessao sai no idioma da pessoa; data invalida vira 'Fecha pendiente'", async () => {
    render(<I18nProvider initialLocale="es"><LearnEventsHub /></I18nProvider>);

    expect(await screen.findByText(
      formatEventDateTime(mocks.startsAt, "es"),
    )).toBeInTheDocument();
    expect(screen.getByText("Fecha pendiente")).toBeInTheDocument();
  });

  it("as proximas primeiro; as que ja passaram ficam numa parte 'Past' fechada, sem pedir presenca", () => {
    const saved = mocks.events;
    const hour = 3_600_000;
    mocks.events = [
      { ...mocks.base, id: "old", title: "Old session", startsAt: "2026-03-14T15:30:00.000Z" },
      { ...mocks.base, id: "next", title: "Next session", startsAt: new Date(Date.now() + 48 * hour).toISOString() },
      // Comecou ha 1h: pode estar rolando, fica em Upcoming com o link de entrar.
      { ...mocks.base, id: "running", title: "Running session", startsAt: new Date(Date.now() - hour).toISOString() },
    ];
    try {
      render(<LearnEventsHub />);

      const upcoming = screen.getByRole("region", { name: "Upcoming" });
      const titles = within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
      expect(titles).toEqual(["Running session", "Next session"]);

      const old = screen.getByRole("heading", { name: "Old session" });
      const past = old.closest("details") as HTMLElement;
      expect(past).not.toHaveAttribute("open");
      // Cabecalho proprio: os cartoes passados nao ficam sob "Upcoming".
      expect(within(past).getByRole("heading", { level: 2, name: /Past/ })).toBeInTheDocument();
      expect(within(past).queryByRole("button", { name: "I will attend" })).not.toBeInTheDocument();
      expect(within(past).queryByRole("link", { name: "Join external session" })).not.toBeInTheDocument();
      // Nem um canal de presenca por cartao passado.
      expect(mocks.rsvpEvents).not.toContain("old");
      // A que passou diz "Held" (antes "Scheduled"); a que esta rolando, "Happening now".
      expect(within(past).getByText("Held")).toBeInTheDocument();
      expect(within(past).queryByText("Scheduled")).not.toBeInTheDocument();
      const running = screen.getByRole("heading", { name: "Running session" }).closest("article") as HTMLElement;
      expect(within(running).getByText("Happening now")).toBeInTheDocument();
    } finally {
      mocks.events = saved;
    }
  });

  it("a resposta escolhida fica marcada no proprio botao (aria-pressed)", () => {
    const saved = mocks.events;
    mocks.events = [
      { ...mocks.base, id: "next", title: "Next session", startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString() },
    ];
    mocks.rsvp = { status: "not_attending" };
    try {
      render(<LearnEventsHub />);

      const group = screen.getByRole("group", { name: "Attendance" });
      expect(within(group).getByRole("button", { name: "I will attend" })).toHaveAttribute("aria-pressed", "false");
      expect(within(group).getByRole("button", { name: "I cannot attend" })).toHaveAttribute("aria-pressed", "true");
      // O texto "Not going" num quadro a parte saiu.
      expect(screen.queryByText("Not going")).not.toBeInTheDocument();
    } finally {
      mocks.events = saved;
      mocks.rsvp = null;
    }
  });

  it("a resposta salva fica marcada na hora, sem esperar o tempo real", async () => {
    const saved = mocks.events;
    mocks.events = [
      { ...mocks.base, id: "next", title: "Next session", startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString() },
    ];
    try {
      render(<LearnEventsHub />);
      const attend = screen.getByRole("button", { name: "I will attend" });
      expect(attend).toHaveAttribute("aria-pressed", "false");

      await act(async () => {
        fireEvent.click(attend);
      });
      expect(screen.getByRole("button", { name: "I will attend" })).toHaveAttribute("aria-pressed", "true");
    } finally {
      mocks.events = saved;
    }
  });

  it("a cancelada aparece marcada, com a hora riscada, sem link nem presenca; depois de 7 dias some", () => {
    const saved = mocks.events;
    const hour = 3_600_000;
    const startsAt = new Date(Date.now() + 24 * hour).toISOString();
    mocks.events = [
      { ...mocks.base, id: "cancelled", title: "Cancelled session", status: "cancelled", startsAt },
      { ...mocks.base, id: "gone", title: "Old cancelled", status: "cancelled", startsAt: new Date(Date.now() - 8 * 24 * hour).toISOString() },
    ];
    mocks.rsvpEvents = [];
    try {
      render(<LearnEventsHub />);

      expect(mocks.options).toEqual({ includeCancelled: true });
      const card = screen.getByRole("heading", { name: "Cancelled session" }).closest("article") as HTMLElement;
      expect(within(card).getByText("Cancelled")).toBeInTheDocument();
      expect(card.querySelector("s")).toHaveTextContent(formatEventDateTime(startsAt, "en"));
      expect(within(card).queryByRole("link")).not.toBeInTheDocument();
      expect(within(card).queryByRole("button")).not.toBeInTheDocument();
      expect(mocks.rsvpEvents).not.toContain("cancelled");
      expect(screen.queryByText("Old cancelled")).not.toBeInTheDocument();
    } finally {
      mocks.events = saved;
    }
  });

  it("'Updated' com a data quando a sessao mudou depois de criada; o prazo sem link diz que nao e reuniao", () => {
    const saved = mocks.events;
    const startsAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    mocks.events = [
      {
        ...mocks.base, id: "moved", title: "Moved session", startsAt,
        createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z",
      },
      { ...mocks.base, id: "due", title: "Essay due", type: "deadline", externalUrl: "", startsAt },
    ];
    try {
      render(<LearnEventsHub />);

      const moved = screen.getByRole("heading", { name: "Moved session" }).closest("article") as HTMLElement;
      expect(within(moved).getByText(`Updated ${formatEventDateTime("2026-11-02T10:00:00.000Z", "en")}`)).toBeInTheDocument();
      const due = screen.getByRole("heading", { name: "Essay due" }).closest("article") as HTMLElement;
      expect(within(due).getByText("This is a due date, not a meeting: there is nothing to join.")).toBeInTheDocument();
      expect(within(due).queryByText(/Updated/)).not.toBeInTheDocument();
      expect(within(due).queryByRole("link", { name: "Join external session" })).not.toBeInTheDocument();
    } finally {
      mocks.events = saved;
    }
  });

  it("depois do 'I will attend': a hora no fuso de quem le e o calendario (Google e .ics)", async () => {
    const saved = mocks.events;
    const startsAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    mocks.events = [{ ...mocks.base, id: "next", title: "Next session", startsAt }];
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:ics");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      render(<LearnEventsHub />);
      // Antes de responder, nada de calendario.
      expect(screen.queryByRole("link", { name: "Add to Google Calendar" })).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "I will attend" }));
      });
      expect(screen.getByText(`You're going: ${formatEventDateTime(startsAt, "en")}`)).toBeInTheDocument();
      const google = screen.getByRole("link", { name: "Add to Google Calendar" });
      expect(google.getAttribute("href")).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&/);
      expect(google).toHaveAttribute("target", "_blank");
      expect(screen.getByText("The calendar entry lasts 60 minutes: the session has no set end time.")).toBeInTheDocument();

      // O endereço do arquivo só é revogado 1 s depois (no iPad o download
      // começa depois do clique). Relógio falso: nenhum timer fica pendente.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      fireEvent.click(screen.getByRole("button", { name: "Download calendar file (.ics)" }));
      expect(click).toHaveBeenCalledOnce();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:ics");
      vi.useRealTimers();
      const blob = createObjectURL.mock.calls[0][0];
      expect(blob.type).toBe("text/calendar;charset=utf-8");
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blob);
      });
      expect(text).toContain("UID:course-event-next@skillsetmind.com");
      expect(text).toContain("URL:https://meet.example.com/live");
    } finally {
      vi.useRealTimers();
      mocks.events = saved;
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
      click.mockRestore();
    }
  });

  // Prazo nao e reuniao: "Due:" e "Open link"; vencido vai para "Past" na
  // hora (nao 3 h depois) e diz "Due date passed", nunca "Happening now".
  it("um prazo: data de entrega e 'Open link'; vencido, em Past como 'Due date passed'", () => {
    const saved = mocks.events;
    const startsAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    mocks.events = [
      { ...mocks.base, id: "due", title: "Essay due", type: "deadline", startsAt },
      { ...mocks.base, id: "late", title: "Quiz due", type: "deadline", startsAt: new Date(Date.now() - 30 * 60_000).toISOString() },
    ];
    try {
      render(<LearnEventsHub />);

      const due = screen.getByRole("heading", { name: "Essay due" }).closest("article") as HTMLElement;
      expect(within(due).getByText(`Due: ${formatEventDateTime(startsAt, "en")}`)).toBeInTheDocument();
      expect(within(due).getByRole("link", { name: "Open link" })).toHaveAttribute("href", "https://meet.example.com/live");
      expect(within(due).queryByRole("link", { name: "Join external session" })).not.toBeInTheDocument();

      const late = screen.getByRole("heading", { name: "Quiz due" }).closest("article") as HTMLElement;
      expect(late.closest("details")).not.toBeNull();
      expect(within(late).getByText("Due date passed")).toBeInTheDocument();
      expect(screen.queryByText("Happening now")).not.toBeInTheDocument();
    } finally {
      mocks.events = saved;
    }
  });

  it("matricula que terminou: diz que o acesso acabou, nao 'nenhuma sessao marcada'", () => {
    const saved = mocks.events;
    mocks.events = [];
    mocks.enrollments = [{ ...mocks.enrollment, status: "refunded" }];
    try {
      render(<LearnEventsHub />);

      expect(screen.getByRole("heading", { level: 2, name: "Your course access ended." })).toBeInTheDocument();
      expect(screen.getByText("Sessions from Demo course no longer appear here because your access ended.")).toBeInTheDocument();
      expect(screen.queryByText("No live sessions are scheduled yet.")).not.toBeInTheDocument();
    } finally {
      mocks.events = saved;
      mocks.enrollments = null;
    }
  });
});
