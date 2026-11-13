// @vitest-environment node
import { describe, expect, it } from "vitest";

import { breaksTextRules } from "./text-rules";

describe("breaksTextRules", () => {
  it.each([
    "Guaranteed results in 30 days",
    "Earn $5,000 a month from home",
    "Make money while you sleep",
    "Build a six-figure coaching business",
    "Passive income for coaches",
    "Cure your anxiety with breathing",
    "Heal old wounds",
    "A treatment plan for burnout",
    "Therapy techniques you can use",
    "Resultados garantizados",
  ])("blocks %s", (text) => {
    expect(breaksTextRules(text)).toBe(true);
  });

  it.each([
    "Healthy morning habits",
    "Pricing your first coaching package",
    "How to run a discovery call",
    "Understanding the habit loop",
    "Set goals you can measure",
  ])("lets %s through", (text) => {
    expect(breaksTextRules(text)).toBe(false);
  });
});
