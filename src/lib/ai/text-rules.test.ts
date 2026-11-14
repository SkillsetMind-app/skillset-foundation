// @vitest-environment node
import { describe, expect, it } from "vitest";

import { breaksTextRules } from "./text-rules";

describe("breaksTextRules", () => {
  it.each([
    "Guaranteed results in 30 days",
    "We guarantee you will land clients",
    "Earn $5,000 a month from home",
    "Make money while you sleep",
    "Make 10k a month coaching",
    "Build a six-figure coaching business",
    "Hit $10k months",
    "$10K/mo with one offer",
    "A 7-figure launch plan",
    "Double your revenue in 90 days",
    "Replace your salary with coaching",
    "Passive income for coaches",
    "Cure your anxiety with breathing",
    "Heal old wounds",
    "Treat your anxiety at home",
    "A treatment plan for burnout",
    "Relieves anxiety in minutes",
    "Lowers cortisol naturally",
    "Overcome depression for good",
    "Boost your immune system",
    "Therapy techniques you can use",
    "Resultados garantizados",
    "Ingresos pasivos para coaches",
    "Libertad financiera en un año",
    "Renda passiva com cursos",
    "Resultado garantido",
    "Tratamiento para la ansiedad",
  ])("blocks %s", (text) => {
    expect(breaksTextRules(text)).toBe(true);
  });

  it.each([
    "Healthy morning habits",
    "Pricing your first coaching package",
    "How to run a discovery call",
    "Understanding the habit loop",
    "Set goals you can measure",
    "Treat yourself after a hard week",
    "How you treat your clients matters",
    "Diagnose your sales funnel",
    "Add a money-back guarantee to your offer",
    "Make 3 calls a day",
    "When should a coach refer a client to a licensed therapist?",
    "Coaching is not therapy",
    "Measure your results each week",
  ])("lets %s through", (text) => {
    expect(breaksTextRules(text)).toBe(false);
  });
});
