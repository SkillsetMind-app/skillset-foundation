import { render, screen } from "@testing-library/react";
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
  return { user: { uid: "student-1", roles: ["student"] }, startsAt, enrollment, events };
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
    onData(mocks.events);
    return () => undefined;
  },
  subscribeToCourseEventRsvp: (_eventId: string, _uid: string, onData: (rsvp: null) => void) => {
    onData(null);
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
});
