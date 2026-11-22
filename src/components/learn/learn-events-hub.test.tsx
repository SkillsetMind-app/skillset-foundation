import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LearnEventsHub } from "@/components/learn/learn-events-hub";
import type { CourseEvent } from "@/domain/course-event";
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
    onData([mocks.enrollment]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: (_slug: string, onData: (events: CourseEvent[]) => void) => {
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
      new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(mocks.startsAt)),
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
});
