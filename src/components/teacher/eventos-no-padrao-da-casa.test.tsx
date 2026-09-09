import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherEventStudio } from "@/components/teacher/teacher-event-studio";
import type { CourseEvent } from "@/domain/course-event";

// O que a pessoa sofria em /teach/events: a tela abria em duas colunas com o
// formulario de cadastro na ESQUERDA e sempre aberto - sete campos antes de
// chegar na agenda. Nenhum numero, nenhum filtro, nenhuma busca, nenhuma
// contagem, e o vazio era um paragrafo sem saida.

const HOUR = 60 * 60 * 1000;

function makeEvent(overrides: Partial<CourseEvent>): CourseEvent {
  return {
    id: "event-1",
    courseId: "course-1",
    courseSlug: "course-1",
    courseTitle: "Clinical supervision",
    ownerId: "teacher-1",
    title: "Live Q&A",
    description: "Bring your hardest case.",
    type: "live_class",
    status: "scheduled",
    startsAt: new Date(Date.now() + 24 * HOUR).toISOString(),
    externalUrl: "https://meet.example.com/live",
    recordingAssetId: null,
    ...overrides,
  };
}

const mocks = vi.hoisted(() => ({
  // O MESMO objeto em todo render: um usuario novo por render reinscreve os
  // efeitos e entra em laco.
  user: { uid: "teacher-1", roles: ["teacher"] },
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams(""),
  events: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: (
    _ownerId: string,
    onData: (courses: Array<Record<string, unknown>>) => void,
  ) => {
    onData([
      {
        id: "course-1",
        ownerId: "teacher-1",
        title: "Clinical supervision",
        summary: "A live cohort",
        category: "Supervision & Continuing Education",
        status: "draft",
        modules: [],
        lessonCount: 0,
      },
    ]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  cancelCourseEvent: vi.fn(),
  createCourseEvent: vi.fn(),
  deleteCourseEvent: vi.fn(),
  subscribeToCourseEventRsvps: (_id: string, onData: (rsvps: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
  subscribeToTeacherCourseEvents: (
    _ownerId: string,
    onData: (events: unknown[]) => void,
  ) => {
    onData(mocks.events);
    return () => undefined;
  },
  updateCourseEvent: vi.fn(),
}));

function renderStudio() {
  return render(
    <I18nProvider initialLocale="en">
      <TeacherEventStudio />
    </I18nProvider>,
  );
}

// A caixa do tile: o texto de apoio e unico na tela, entao o numero grande e o
// irmao dele dentro do mesmo card.
function tile(hint: string) {
  const card = screen.getByText(hint).closest("div");
  if (!card) {
    throw new Error(`tile nao encontrado para "${hint}"`);
  }
  return within(card);
}

describe("agenda de eventos no padrao da casa", () => {
  beforeEach(() => {
    mocks.searchParams = new URLSearchParams("");
    mocks.events = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("abre com a lista e ZERO formulario; o formulario so entra depois do pedido", () => {
    mocks.events = [makeEvent({ id: "event-1", title: "Live Q&A" })];
    renderStudio();

    expect(screen.getByText("Live Q&A")).toBeInTheDocument();
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("External class link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    expect(screen.getByLabelText("Date and time")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Course" })).toBeInTheDocument();
  });

  it("resumo compacto e formulario sem molduras empilhadas preservam os controles", () => {
    const { container } = renderStudio();
    const summary = container.querySelector("dl");
    expect(summary).toHaveClass("grid-cols-3");
    expect(summary?.querySelectorAll("dt")).toHaveLength(3);
    expect(container.querySelector(".studio-kpi-card")).toBeNull();
    expect(container.querySelector(".settings-section-card")).toBeNull();
    const trigger = screen.getByRole("button", { name: "New session" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    const panel = document.getElementById(trigger.getAttribute("aria-controls")!);
    expect(panel).toContainElement(screen.getByLabelText("Date and time"));
    expect(panel).toHaveClass("border-b");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
  });

  it("tres tiles contam o que vem, o que passou e o que foi cancelado", () => {
    mocks.events = [
      makeEvent({ id: "a", startsAt: new Date(Date.now() + 24 * HOUR).toISOString() }),
      makeEvent({ id: "b", startsAt: new Date(Date.now() + 48 * HOUR).toISOString() }),
      makeEvent({ id: "c", startsAt: new Date(Date.now() - 24 * HOUR).toISOString() }),
      makeEvent({ id: "d", status: "cancelled" }),
    ];
    renderStudio();

    expect(tile("Still ahead on the agenda").getByText("2")).toBeInTheDocument();
    expect(tile("Already happened").getByText("1")).toBeInTheDocument();
    expect(tile("Called off — everyone who RSVP'd saw it").getByText("1")).toBeInTheDocument();
  });

  it("a moldura (filtro, busca, exportar) e a contagem dizem de que recorte a lista fala", () => {
    mocks.events = [
      makeEvent({ id: "a", title: "Live Q&A" }),
      makeEvent({ id: "b", title: "Case clinic" }),
      makeEvent({ id: "c", title: "Old class", startsAt: new Date(Date.now() - 24 * HOUR).toISOString() }),
    ];
    renderStudio();

    expect(screen.getByLabelText("Filter sessions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByText("2 sessions · Upcoming")).toBeInTheDocument();

    // Mesma moldura de Vendas: a busca precisa de largura minima para nao
    // encolher a 35 px no celular.
    expect(screen.getByLabelText("Search sessions by title or course")).toHaveClass(
      "min-w-[12rem]",
    );
    fireEvent.change(screen.getByLabelText("Search sessions by title or course"), {
      target: { value: "case" },
    });

    expect(screen.getByText("1 session · Upcoming")).toBeInTheDocument();
    expect(screen.queryByText("Live Q&A")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter sessions"), {
      target: { value: "past" },
    });

    expect(screen.getByText("0 sessions · Past")).toBeInTheDocument();
  });

  it("sem sessoes, o vazio tem duas linhas e um botao que abre o formulario", () => {
    renderStudio();

    expect(screen.getByText("No sessions in this view.")).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing matches this filter and search/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Schedule a session" }));

    expect(screen.getByLabelText("Date and time")).toBeInTheDocument();
  });
});
