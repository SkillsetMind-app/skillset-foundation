import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CourseOverviewPanelView } from "@/components/teacher/course-overview-panel";
import { getCourseOverviewStats } from "@/domain/course-overview";
import type { CourseMaintenanceIssue } from "@/domain/course-overview";
import type { TeacherCourse } from "@/domain/teacher-course";

// A aba "Panel" do produto so respondia "quanto falta para publicar". Estas
// provas cobrem o que ela passou a responder: os quatro numeros do produto, o
// estado vazio de quem ainda nao vendeu, e a lista de manutencao.

const course = {
  id: "course-1",
  title: "Hypnosis Basics",
  status: "published",
  ratingAverage: 4.5,
  ratingCount: 4,
} as TeacherCourse;

const emptyStats = getCourseOverviewStats({ course, students: [], orders: [] });

const busyStats = getCourseOverviewStats({
  course,
  students: [
    { courseId: "course-1", status: "active", progressPercent: 100, enrolledAt: "2026-08-01" },
    { courseId: "course-1", status: "active", progressPercent: 20, enrolledAt: "2026-08-02" },
    // Aluno de OUTRO produto: a leitura traz a loja inteira.
    { courseId: "course-2", status: "active", progressPercent: 90, enrolledAt: "2026-08-03" },
  ],
  orders: [
    {
      courseId: "course-1",
      status: "paid",
      currency: "usd",
      amountMinor: 9900,
      refundedAmountMinor: 0,
    },
    { courseId: "course-2", status: "paid", currency: "usd", amountMinor: 500000 },
  ],
});

afterEach(cleanup);

describe("CourseOverviewPanelView", () => {
  it("answers the four questions the teacher opens this screen to ask", () => {
    render(
      <CourseOverviewPanelView
        course={course}
        stats={busyStats}
        issues={[]}
        loading={false}
      />,
    );

    // Matriculados, receita, conclusao e nota — deste produto, nao da loja.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("$99.00")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("4.5")).toBeInTheDocument();
    expect(screen.queryByText("$5,000.00")).toBeNull();
    expect(screen.getByText(/1 of 2 finished the course/)).toBeInTheDocument();
  });

  it("says nobody bought it yet instead of showing a grid of zeros", () => {
    render(
      <CourseOverviewPanelView
        course={course}
        stats={emptyStats}
        issues={[]}
        loading={false}
      />,
    );

    expect(screen.getByText(/No one has bought this product yet/)).toBeInTheDocument();
    expect(screen.queryByText("Students enrolled")).toBeNull();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("sends a draft to the checklist and a live product to its public page", () => {
    const { unmount } = render(
      <CourseOverviewPanelView
        course={{ ...course, status: "draft" } as TeacherCourse}
        stats={emptyStats}
        issues={[]}
        loading={false}
      />,
    );

    expect(screen.getByText(/Publish the course first/)).toBeInTheDocument();
    unmount();

    render(
      <CourseOverviewPanelView
        course={course}
        stats={emptyStats}
        issues={[]}
        loading={false}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Open the product page" }),
    ).toHaveAttribute("href", "/courses/course-1");
  });

  it("carries the two ways of looking at the product the way a buyer would", () => {
    render(
      <CourseOverviewPanelView
        course={course}
        stats={busyStats}
        issues={[]}
        loading={false}
      />,
    );

    expect(screen.getByRole("link", { name: /View public page/ })).toHaveAttribute(
      "href",
      "/courses/course-1",
    );
    expect(screen.getByRole("link", { name: /Preview as a student/ })).toHaveAttribute(
      "href",
      "/teach/builder/course-1/preview",
    );
  });

  it("lists what is broken on this product, and hides the card when nothing is", () => {
    const issues: CourseMaintenanceIssue[] = [
      { id: "empty-lessons", title: "1 lesson has no content", hint: "Intro opens empty." },
    ];

    const { unmount } = render(
      <CourseOverviewPanelView
        course={course}
        stats={busyStats}
        issues={issues}
        loading={false}
      />,
    );

    expect(screen.getByText("Needs your attention")).toBeInTheDocument();
    expect(screen.getByText("1 lesson has no content")).toBeInTheDocument();
    unmount();

    render(
      <CourseOverviewPanelView course={course} stats={busyStats} issues={[]} loading={false} />,
    );
    expect(screen.queryByText("Needs your attention")).toBeNull();
  });

  it("waits for the roster read instead of claiming zero students", () => {
    render(
      <CourseOverviewPanelView course={course} stats={emptyStats} issues={[]} loading />,
    );

    expect(screen.getByTestId("course-overview-loading")).toBeInTheDocument();
    expect(screen.queryByText(/No one has bought this product yet/)).toBeNull();
  });
});
