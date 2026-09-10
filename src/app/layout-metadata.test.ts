import { afterEach, describe, expect, it, vi } from "vitest";

import { brand } from "@/data/brand";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === LOCALE_COOKIE ? { value: state.locale } : undefined),
  }),
  headers: async () => new Headers(),
}));
// Only what the root layout pulls from outside the app; the metadata itself is real.
vi.mock("next/font/google", () => ({
  Manrope: () => ({ variable: "" }),
  Cormorant_Garamond: () => ({ variable: "" }),
  Inter: () => ({ variable: "" }),
}));
vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/next", () => ({ SpeedInsights: () => null }));

import { generateMetadata } from "@/app/layout";

afterEach(() => {
  state.locale = "en";
});

// The default title is what every page without its own title shows in the
// browser tab — the whole classroom and teacher studio among them.
describe("default site title", () => {
  it("keeps the brand title in English", async () => {
    expect(await generateMetadata()).toMatchObject({ title: brand.title, description: brand.description });
  });

  it("follows the Spanish language cookie", async () => {
    state.locale = "es";
    expect(await generateMetadata()).toMatchObject({
      title: "SkillsetMind | Coaching, desarrollo personal y potencial humano",
      description: "Una plataforma vertical de negocio y aprendizaje para coaching, desarrollo personal y potencial humano.",
    });
  });
});
