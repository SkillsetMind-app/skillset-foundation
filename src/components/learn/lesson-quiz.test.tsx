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

it("asks only for the published quiz and shows nothing without one", async () => {
  quiz.result = { data: null, error: null };
  const { container } = render(<LessonQuiz lessonId="l1" />);
  await Promise.resolve();
  expect(container).toBeEmptyDOMElement();
  expect(quiz.filters).toContainEqual(["status", "published"]);
  expect(quiz.filters).toContainEqual(["lesson_id", "l1"]);
});

it("corrects each answer on the spot, scores at the end and starts over", async () => {
  render(<LessonQuiz lessonId="l1" />);
  expect(await screen.findByRole("heading", { name: "Check your understanding" })).toBeInTheDocument();

  const [first, second] = screen.getAllByRole("group");
  fireEvent.click(first.querySelectorAll("input")[1]);
  expect(first).toHaveTextContent("Not quite. The cue comes first.");
  expect(first.querySelectorAll("input")[0]).toBeDisabled();

  fireEvent.click(second.querySelectorAll("input")[1]);
  expect(second).toHaveTextContent("Correct. The reward closes the loop.");
  expect(screen.getByRole("status")).toHaveTextContent("You got 1 of 2 right.");

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.queryByText(/Not quite/)).not.toBeInTheDocument();
});
