import { askJson } from "./openai";
import { breaksTextRules } from "./text-rules";

// Quiz e sugestão de título/descrição a partir da transcrição da aula (o texto
// da legenda). A IA só organiza o que o professor disse: nada de fato de fora,
// nada de promessa de resultado ou de saúde. O professor revisa tudo antes.

export type QuizQuestion = { question: string; options: string[]; answer: number; explanation: string };

// Transcrição máxima enviada: ~2 h de fala. Corta no fim, não no meio da aula.
const MAX_TRANSCRIPT_CHARS = 150_000;
const QUIZ_LIMITS = { questions: [1, 10], options: [2, 5], question: 300, option: 200, explanation: 500 } as const;

const RULES = [
  "Use only what the teacher says in the material; never add outside facts.",
  "Write in the same language as the material.",
  "Never promise results, income, success, health benefits or cures, and never mention therapy, treatment or diagnosis.",
  "No hype, no emojis, no exclamation marks.",
].join(" ");

const QUIZ_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "integer" },
          explanation: { type: "string" },
        },
        required: ["question", "options", "answer", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    titles: { type: "array", items: { type: "string" } },
    descriptions: { type: "array", items: { type: "string" } },
  },
  required: ["titles", "descriptions"],
  additionalProperties: false,
};

/**
 * Quiz válido ou erro "quiz_invalid". Vale para o que a IA devolve e para o que
 * o professor editou: o banco só recebe o que passou por aqui.
 */
export function cleanQuiz(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) throw new Error("quiz_invalid");
  const [minQ, maxQ] = QUIZ_LIMITS.questions;
  const [minO, maxO] = QUIZ_LIMITS.options;
  const text = (value: unknown, max: number) => {
    if (typeof value !== "string") throw new Error("quiz_invalid");
    const clean = value.trim();
    if (!clean || clean.length > max) throw new Error("quiz_invalid");
    return clean;
  };
  const questions = raw.map((item) => {
    const q = item as Partial<QuizQuestion> | null;
    if (!q || !Array.isArray(q.options)) throw new Error("quiz_invalid");
    const options = q.options.map((option) => text(option, QUIZ_LIMITS.option));
    if (options.length < minO || options.length > maxO || new Set(options).size !== options.length) {
      throw new Error("quiz_invalid");
    }
    if (!Number.isInteger(q.answer) || (q.answer as number) < 0 || (q.answer as number) >= options.length) {
      throw new Error("quiz_invalid");
    }
    return {
      question: text(q.question, QUIZ_LIMITS.question),
      options,
      answer: q.answer as number,
      explanation: text(q.explanation, QUIZ_LIMITS.explanation),
    };
  });
  if (questions.length < minQ || questions.length > maxQ) throw new Error("quiz_invalid");
  return questions;
}

export async function generateQuiz(transcript: string, deadline: AbortSignal): Promise<QuizQuestion[]> {
  const reply = await askJson<{ questions: unknown[] }>({
    system: [
      "You write a short multiple-choice quiz that checks whether a student understood one lesson of an online course.",
      "Write 3 to 8 questions, each with 3 or 4 options and exactly one correct option.",
      "`answer` is the zero-based index of the correct option. Each explanation is one sentence that points back to what the lesson said.",
      "Ask about ideas and steps the lesson teaches, not trivia, and no trick questions.",
      RULES,
    ].join(" "),
    user: transcript.slice(0, MAX_TRANSCRIPT_CHARS),
    schemaName: "lesson_quiz",
    schema: QUIZ_SCHEMA,
    signal: deadline,
  });
  // Pergunta que passa da regra de texto ou vem malformada sai; o resto fica.
  const kept = (Array.isArray(reply.questions) ? reply.questions : []).flatMap((item) => {
    try {
      const [question] = cleanQuiz([item]);
      const words = [question.question, ...question.options, question.explanation].join(" ");
      return breaksTextRules(words) ? [] : [question];
    } catch {
      return [];
    }
  });
  if (kept.length === 0) throw new Error("quiz_empty");
  return kept.slice(0, QUIZ_LIMITS.questions[1]);
}

export async function suggestTitleAndDescription(
  kind: "lesson" | "module",
  material: string,
  deadline: AbortSignal,
): Promise<{ titles: string[]; descriptions: string[] }> {
  const reply = await askJson<{ titles: unknown; descriptions: unknown }>({
    system: [
      `You suggest a title and a short description for one ${kind} of an online course, from the teacher's own material.`,
      "Give 3 titles of at most 8 words, plain and specific to the content, and 3 descriptions of one or two sentences saying what the",
      kind === "lesson" ? "lesson covers." : "module covers.",
      RULES,
    ].join(" "),
    user: material.slice(0, MAX_TRANSCRIPT_CHARS),
    schemaName: "title_description",
    schema: SUGGEST_SCHEMA,
    signal: deadline,
  });
  const keep = (list: unknown, max: number) =>
    (Array.isArray(list) ? list : [])
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item && item.length <= max && !breaksTextRules(item))
      .slice(0, 3);
  const titles = keep(reply.titles, 120);
  const descriptions = keep(reply.descriptions, 500);
  if (titles.length === 0 && descriptions.length === 0) throw new Error("suggest_empty");
  return { titles, descriptions };
}
