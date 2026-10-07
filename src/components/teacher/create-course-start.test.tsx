import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateCourseStart } from "@/components/teacher/create-course-start";

const mocks = vi.hoisted(() => ({
  createTeacherCourse: vi.fn(),
  createCourseEvent: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  createTeacherCourse: mocks.createTeacherCourse,
}));

vi.mock("@/lib/data/course-events", () => ({
  createCourseEvent: mocks.createCourseEvent,
}));

// O evento ao vivo recusa data passada: o relogio fica parado num dia antes
// das datas dos testes, que assim nao vencem.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T12:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

function selectPrimaryCategory() {
  fireEvent.click(screen.getByRole("button", { name: /Select up to 5 categories/i }));
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Applied Psychology & Behavior",
    })
  );
}

function fillBasics(title = "Clinical performance foundations") {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText(/^Description/), {
    target: { value: "Build a repeatable practice for evidence-informed performance work." },
  });
  selectPrimaryCategory();
}

describe("CreateCourseStart — tela 1: o que voce vai entregar", () => {
  beforeEach(() => {
    mocks.createTeacherCourse.mockReset().mockResolvedValue("course-123");
    mocks.createCourseEvent.mockReset().mockResolvedValue("event-1");
    mocks.push.mockReset();
  });

  it("mostra quatro tipos, cada um com a sua frase, e nada de grátis, assinatura ou programa", () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    expect(screen.getByRole("heading", { name: "What will you deliver?" })).toBeInTheDocument();
    const cards = within(screen.getByRole("group", { name: "What will you deliver?" })).getAllByRole("button");
    expect(cards.map((card) => card.querySelector("strong")?.textContent)).toEqual([
      "Course",
      "Community",
      "Live event",
      "E-book",
    ]);
    expect(screen.getByText("Recorded lessons people watch at their own pace.")).toBeInTheDocument();
    expect(screen.getByText(/A members' space where you post, answer and run live calls/)).toBeInTheDocument();
    expect(screen.getByText("A workshop or class on a set date, by Zoom or Meet.")).toBeInTheDocument();
    expect(screen.getByText("A file people download: PDF, slides, workbook.")).toBeInTheDocument();
    expect(screen.queryByText(/Guided program|Free program|Subscription/)).toBeNull();
    // O nome vem na tela 2.
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("clicar num cartao escolhe, avanca e leva o foco ao titulo da tela 2", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /^Community/ }));

    const heading = await screen.findByRole("heading", { name: "Name your community" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("Continue avanca com o tipo ja marcado; Back volta e devolve o foco a tela 1", async () => {
    render(<CreateCourseStart ownerId="teacher-1" initialFormat="ebook" />);

    expect(screen.getByRole("button", { name: /^E-book/ })).toHaveAttribute("aria-pressed", "true");
    // Na primeira pintura o foco nao e roubado.
    expect(screen.getByRole("heading", { name: "What will you deliver?" })).not.toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Name your e-book" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "What will you deliver?" })).toHaveFocus();
    });
    expect(screen.getByRole("button", { name: /^E-book/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("o rail marca Format feito ao passar para a tela 2", () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    const rail = screen.getByRole("list", { name: "Product creation progress" });
    const [format, basics] = within(rail).getAllByRole("listitem");
    expect(format).toHaveAttribute("aria-current", "step");
    expect(format.querySelector("svg")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(format.querySelector("svg")).not.toBeNull();
    expect(basics).toHaveAttribute("aria-current", "step");
    expect(within(rail).getAllByText(/continues in the builder/i)).toHaveLength(3);
  });
});

describe("CreateCourseStart — tela 2 grava o tipo", () => {
  beforeEach(() => {
    mocks.createTeacherCourse.mockReset().mockResolvedValue("course-123");
    mocks.createCourseEvent.mockReset().mockResolvedValue("event-1");
    mocks.push.mockReset();
  });

  it.each([
    ["Course", "course", "one_time", false, "Module 1", "Lesson 1"],
    ["Community", "community", "subscription_monthly", true, "Module 1", "Lesson 1"],
    ["E-book", "ebook", "one_time", false, "Download", "Clinical performance foundations"],
  ] as const)(
    "%s: grava product_format e abre o conteudo",
    async (card, productFormat, paymentType, communityEnabled, moduleTitle, lessonTitle) => {
      render(<CreateCourseStart ownerId="teacher-1" />);

      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${card}`) }));
      fillBasics();
      fireEvent.click(screen.getByRole("button", { name: /^Create/ }));

      await waitFor(() => {
        expect(mocks.createTeacherCourse).toHaveBeenCalledWith({
          ownerId: "teacher-1",
          title: "Clinical performance foundations",
          summary: "Build a repeatable practice for evidence-informed performance work.",
          category: "Applied Psychology & Behavior",
          categories: ["Applied Psychology & Behavior"],
          paymentType,
          communityEnabled,
          productFormat,
          moduleTitle,
          lessonTitle,
        });
      });
      expect(mocks.createCourseEvent).not.toHaveBeenCalled();
      expect(mocks.push).toHaveBeenCalledWith("/teach/builder?courseId=course-123&tab=content");
    },
  );

  it("evento ao vivo: data e hora na mesma tela; o link pode ficar para depois", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /^Live event/ }));
    expect(screen.getByRole("heading", { name: "Name your live event" })).toBeInTheDocument();
    fillBasics("Live supervision intensive");

    const create = screen.getByRole("button", { name: /^Create/ });
    expect(create).toBeDisabled();
    expect(screen.getByText(/Choose the date and time of the session/)).toBeInTheDocument();
    expect(screen.getByText("Optional. You can add it later.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-20" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "19:30" } });
    expect(create).toBeEnabled();
    fireEvent.click(create);

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({ productFormat: "live_event", paymentType: "one_time" }),
      );
    });
    await waitFor(() => {
      expect(mocks.createCourseEvent).toHaveBeenCalledWith({
        courseId: "course-123",
        courseSlug: "course-123",
        courseTitle: "Live supervision intensive",
        ownerId: "teacher-1",
        title: "Live supervision intensive",
        description: "",
        type: "live_class",
        startsAt: new Date("2026-11-20T19:30").toISOString(),
        externalUrl: "",
      });
    });
    expect(mocks.push).toHaveBeenCalledWith("/teach/builder?courseId=course-123&tab=content");
  });

  it("evento ao vivo: link digitado precisa ser um endereco completo", () => {
    render(<CreateCourseStart ownerId="teacher-1" initialFormat="live_event" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fillBasics();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-20" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "19:30" } });
    fireEvent.change(screen.getByLabelText("Zoom or Meet link"), { target: { value: "meet.google" } });

    expect(screen.getByRole("button", { name: /^Create/ })).toBeDisabled();
    expect(screen.getByText(/Use a full link that starts with https/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Zoom or Meet link"), {
      target: { value: "https://meet.google.com/abc-defg-hij" },
    });
    expect(screen.getByRole("button", { name: /^Create/ })).toBeEnabled();
  });

  it("evento ao vivo: hora que ja passou trava o envio, e o campo de data comeca hoje", () => {
    render(<CreateCourseStart ownerId="teacher-1" initialFormat="live_event" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fillBasics();
    expect(screen.getByLabelText("Date")).toHaveAttribute("min", "2026-10-01");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "09:00" } });

    const create = screen.getByRole("button", { name: /^Create/ });
    expect(create).toBeDisabled();
    expect(screen.getByText(/Choose a date and time that has not passed yet/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "18:00" } });
    expect(create).toBeEnabled();
  });

  it("evento ao vivo: se a hora passa com a tela aberta, o envio confere de novo", async () => {
    render(<CreateCourseStart ownerId="teacher-1" initialFormat="live_event" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fillBasics();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "13:00" } });
    vi.setSystemTime(new Date("2026-10-01T14:00:00"));
    fireEvent.click(screen.getByRole("button", { name: /^Create/ }));

    expect(await screen.findByText(/Choose a date and time that has not passed yet/)).toBeInTheDocument();
    expect(mocks.createTeacherCourse).not.toHaveBeenCalled();
    expect(mocks.createCourseEvent).not.toHaveBeenCalled();
  });

  it("so o evento pergunta data, hora e link", () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /^Course/ }));

    expect(screen.queryByLabelText("Date")).toBeNull();
    expect(screen.queryByLabelText("Zoom or Meet link")).toBeNull();
  });

  it("nomeia cada condicao pendente, e some quando todas sao atendidas", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText(/Before you continue:/i)).toBeInTheDocument();
    expect(screen.getByText(/Give it a name \(3\+ characters\)/)).toBeInTheDocument();
    expect(screen.getByText(/at least 20 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/Choose a marketplace category/i)).toBeInTheDocument();

    fillBasics();

    await waitFor(() => {
      expect(screen.queryByText(/Before you continue:/i)).not.toBeInTheDocument();
    });
  });

  // Criar o produto e um dos dois marcos: latao (nao o navy de toda acao).
  it("o botao de criar e o de latao grande com seta", () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const submit = screen.getByRole("button", { name: /^Create/ });
    expect(submit).toHaveClass("button-accent", "button-lg");
    expect(submit).not.toHaveClass("button-solid");
    expect(submit.querySelector("svg")).not.toBeNull();
  });

  it("o campo de texto se chama Description; nada de promise", () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByLabelText(/^Description/)).toBeInTheDocument();
    expect(screen.queryByText(/promise/i)).not.toBeInTheDocument();
  });
});
