import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateCourseStart } from "@/components/teacher/create-course-start";

const mocks = vi.hoisted(() => ({
  createTeacherCourse: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  createTeacherCourse: mocks.createTeacherCourse,
}));

function selectPrimaryCategory() {
  fireEvent.click(screen.getByRole("button", { name: /Select up to 5 categories/i }));
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Applied Psychology & Behavior",
    })
  );
}

describe("CreateCourseStart", () => {
  beforeEach(() => {
    mocks.createTeacherCourse.mockReset();
    mocks.createTeacherCourse.mockResolvedValue("course-123");
    mocks.push.mockReset();
  });

  it.each([
    ["Monthly", "subscription_monthly"],
    ["Yearly", "subscription_yearly"],
  ])("creates a %s subscription product and opens pricing", async (interval, paymentType) => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Subscription/i }));
    fireEvent.click(screen.getByRole("button", { name: interval }));
    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Clinical performance foundations" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/), {
      target: {
        value: "Build a repeatable practice for evidence-informed performance work.",
      },
    });
    selectPrimaryCategory();
    fireEvent.click(screen.getByRole("button", { name: /Create and set pricing/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: "teacher-1",
          paymentType,
        })
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/teach/builder?courseId=course-123&tab=pricing");
  });

  it("keeps free products out of the pricing step", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Free program/i }));
    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Open clinical toolkit" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/), {
      target: { value: "Use a practical set of open exercises with your clients." },
    });
    selectPrimaryCategory();
    fireEvent.click(screen.getByRole("button", { name: /Create and add content/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({ paymentType: "free" })
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/teach/builder?courseId=course-123&tab=content");
  });

  it("creates a recurring community product with its members community enabled", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Community/i }));
    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Clinical supervision community" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/), {
      target: {
        value: "Create a protected peer space for recurring clinical supervision.",
      },
    });
    selectPrimaryCategory();
    fireEvent.click(screen.getByRole("button", { name: /Create and set pricing/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentType: "subscription_monthly",
          communityEnabled: true,
        })
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/teach/builder?courseId=course-123&tab=pricing");
  });

  it("creates an event product before opening its linked scheduling form", async () => {
    render(<CreateCourseStart ownerId="teacher-1" initialFormat="event" />);

    expect(screen.getByRole("button", { name: /Online event/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Live clinical supervision intensive" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/), {
      target: { value: "Practice advanced supervision methods in a live facilitated cohort." },
    });
    selectPrimaryCategory();
    fireEvent.click(screen.getByRole("button", { name: /Create and schedule event/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentType: "one_time",
          communityEnabled: false,
        })
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/teach/events?courseId=course-123&newEvent=1");
  });

  it("creates a guided program as a structured paid-content preset", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Guided program/i }));
    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Eight-week resilience program" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/), {
      target: { value: "Follow a sequenced eight-week path of learning, practice, and reflection." },
    });
    selectPrimaryCategory();
    fireEvent.click(screen.getByRole("button", { name: /Create and set pricing/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({ paymentType: "one_time" }),
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/teach/builder?courseId=course-123&tab=pricing");
  });

  it("keeps categories collapsed until the teacher opens them", () => {
    render(<CreateCourseStart ownerId="teacher-1" initialFormat="subscription" />);

    expect(screen.getByRole("button", { name: /Subscription/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByRole("group", { name: /Course categories/i })).toBeNull();

    const categoryTrigger = screen.getByRole("button", {
      name: /Select up to 5 categories/i,
    });
    expect(categoryTrigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(categoryTrigger);
    expect(screen.getByRole("group", { name: /Course categories/i })).toBeInTheDocument();
  });
});

describe("CreateCourseStart — uma tela so, cinco estagios", () => {
  // Criar um produto pedia duas telas (formato -> informacoes). O rail
  // prometia tres passos, o formulario dizia "passo 1 de 2" e o terceiro
  // passo nunca acendia. Agora formato, titulo, promessa e categoria ficam no
  // mesmo formulario, e o rail mostra os cinco estagios do fluxo inteiro,
  // dizendo onde cada um acontece.
  it("mostra formato e campos no mesmo formulario, sem contador de passos", () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    expect(screen.getByRole("button", { name: /Online course/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Product title")).toBeInTheDocument();
    expect(screen.getByLabelText(/Product promise/)).toBeInTheDocument();
    expect(screen.queryByText(/Step \d of \d/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Continue$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Back$/i })).toBeNull();
  });

  it("o rail lista os cinco estagios e diz que os tres ultimos continuam no construtor", () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    const rail = screen.getByRole("list", { name: "Product creation progress" });
    const stages = within(rail).getAllByRole("listitem");

    expect(stages.map((stage) => within(stage).getByText(/^(Format|Basics|Pricing|Lessons|Publish)$/).textContent)).toEqual([
      "Format",
      "Basics",
      "Pricing",
      "Lessons",
      "Publish",
    ]);
    expect(within(rail).getAllByText(/continues in the builder/i)).toHaveLength(3);
  });

  it("Format ja nasce feito; Basics acende quando titulo, promessa e categoria estao ok", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    const rail = screen.getByRole("list", { name: "Product creation progress" });
    const [format, basics] = within(rail).getAllByRole("listitem");

    expect(format.querySelector("svg")).not.toBeNull();
    expect(basics.querySelector("svg")).toBeNull();
    expect(basics).toHaveAttribute("aria-current", "step");

    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Clinical performance foundations" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/), {
      target: { value: "A practical course about clinical performance." },
    });
    selectPrimaryCategory();

    await waitFor(() => {
      expect(basics.querySelector("svg")).not.toBeNull();
    });
  });
});

describe("CreateCourseStart — o que falta para continuar", () => {
  // O botão ficava só cinza. Nada na tela dizia se faltava título, resumo ou
  // categoria, e os mínimos (3 e 20 caracteres) não apareciam em lugar nenhum:
  // quem escrevia um resumo de 15 caracteres via um botão morto sem motivo.
  it("nomeia cada condição pendente, e some quando todas são atendidas", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /One-time/i }));

    expect(screen.getByText(/Before you continue:/i)).toBeInTheDocument();
    expect(screen.getByText(/Give the course a title/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 20 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/Choose a marketplace category/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Clinical performance foundations" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/i), {
      target: { value: "A practical course about clinical performance." },
    });
    selectPrimaryCategory();

    await waitFor(() => {
      expect(screen.queryByText(/Before you continue:/i)).not.toBeInTheDocument();
    });
  });
});
