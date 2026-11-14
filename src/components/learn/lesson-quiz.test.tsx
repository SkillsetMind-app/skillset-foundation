import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const quiz = vi.hoisted(() => ({ result: { data: null as unknown, error: null }, filters: [] as unknown[][] }));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => {
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => {
        quiz.filters.push(args);
        return query;
      },
      maybeSingle: async () => quiz.result,
    };
    return { from: () => query };
  },
}));

import { LessonQuiz } from "./lesson-quiz";

const questions = [
  { question: "What starts a habit loop?", options: ["A cue", "A reward"], answer: 0, explanation: "The cue comes first." },
  { question: "What ends it?", options: ["A cue", "A reward"], answer: 1, explanation: "The reward closes the loop." },
];

beforeEach(() => {
  quiz.filters.length = 0;
  quiz.result = { data: { questions }, error: null };
});

it("asks only for this course's published quiz and shows nothing without one", async () => {
  quiz.result = { data: null, error: null };
  const { container } = render(<LessonQuiz courseId="c1" lessonId="l1" />);
  await Promise.resolve();
  expect(container).toBeEmptyDOMElement();
  expect(quiz.filters).toContainEqual(["status", "published"]);
  expect(quiz.filters).toContainEqual(["course_id", "c1"]);
  expect(quiz.filters).toContainEqual(["lesson_id", "l1"]);
});

it("lets the student change the choice, checks on demand, shows the right answer, scores and starts over", async () => {
  render(<LessonQuiz courseId="c1" lessonId="l1" />);
  expect(await screen.findByRole("heading", { name: "Check your understanding" })).toBeInTheDocument();

  const [first, second] = screen.getAllByRole("group");
  const firstRadios = first.querySelectorAll("input");
  // Marcar não confere: dá para trocar antes de "Check" (setas do teclado).
  fireEvent.click(firstRadios[0]);
  fireEvent.click(firstRadios[1]);
  expect(firstRadios[0]).not.toBeDisabled();
  fireEvent.click(first.querySelector("button")!);
  expect(first).toHaveTextContent("Not quite. The answer: A cue. The cue comes first.");
  expect(firstRadios[0]).toBeDisabled();

  fireEvent.click(second.querySelectorAll("input")[1]);
  fireEvent.click(second.querySelector("button")!);
  expect(second).toHaveTextContent("Correct. The reward closes the loop.");
  expect(screen.getByRole("status")).toHaveTextContent("You got 1 of 2 right.");

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.queryByText(/Not quite/)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Check your understanding" })).toHaveFocus();
});
