// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const askJson = vi.hoisted(() => vi.fn());
vi.mock("./openai", () => ({ askJson }));

import { cleanQuiz, generateQuiz, suggestTitleAndDescription } from "./lesson-text";

const deadline = new AbortController().signal;
const good = { question: "What is a habit loop?", options: ["Cue, routine, reward", "A to-do list"], answer: 0, explanation: "The lesson names the three steps." };

describe("cleanQuiz", () => {
  it("keeps a valid quiz and trims it", () => {
    expect(cleanQuiz([{ ...good, question: "  What is a habit loop? " }])).toEqual([good]);
  });

  it.each([
    ["no questions", []],
    ["answer out of range", [{ ...good, answer: 2 }]],
    ["one option", [{ ...good, options: ["Only"] }]],
    ["repeated options", [{ ...good, options: ["Same", "Same"] }]],
    ["empty explanation", [{ ...good, explanation: " " }]],
    ["eleven questions", Array.from({ length: 11 }, () => good)],
  ])("refuses %s", (_label, quiz) => {
    expect(() => cleanQuiz(quiz)).toThrow("quiz_invalid");
  });
});

describe("generateQuiz", () => {
  beforeEach(() => askJson.mockReset());

  it("drops questions that break the text rules or come malformed", async () => {
    askJson.mockResolvedValue({
      questions: [
        good,
        { ...good, question: "Which habit cures anxiety?" },
        { ...good, answer: 9 },
      ],
    });
    await expect(generateQuiz("transcript", deadline)).resolves.toEqual([good]);
  });

  it("fails when nothing usable is left", async () => {
    askJson.mockResolvedValue({ questions: [{ ...good, explanation: "Guaranteed results." }] });
    await expect(generateQuiz("transcript", deadline)).rejects.toThrow("quiz_empty");
  });
});

describe("suggestTitleAndDescription", () => {
  beforeEach(() => askJson.mockReset());

  it("keeps up to three clean suggestions of each kind", async () => {
    askJson.mockResolvedValue({
      titles: ["Build your first habit", "Earn $5,000 a month with habits", "The habit loop", "Small daily steps", "Extra"],
      descriptions: ["How cue, routine and reward fit together."],
    });
    await expect(suggestTitleAndDescription("lesson", "material", deadline)).resolves.toEqual({
      titles: ["Build your first habit", "The habit loop", "Small daily steps"],
      descriptions: ["How cue, routine and reward fit together."],
    });
    expect(askJson.mock.calls[0][0].system).toContain("one lesson of an online course");
  });
});
