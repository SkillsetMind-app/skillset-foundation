import { describe, expect, it, vi } from "vitest";
import { generateMetadata as homeMetadata } from "@/app/page";
import { generateMetadata as recoveryMetadata } from "@/app/forgot-password/page";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";

const state = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("@/lib/i18n/server", () => ({
  getServerTranslation: async () => ({
    locale: state.locale,
    t: (key: string) => translate(getDictionary(state.locale), key),
  }),
}));

describe("public entry metadata follows the selected language", () => {
  it.each([
    ["en", "Course platform for psychologists & coaches | SkillsetMind", "SkillsetMind is where psychologists"],
    ["es", "Plataforma de cursos para psicólogos y coaches | SkillsetMind", "SkillsetMind es donde psicólogos"],
  ] as const)("translates the home title and sharing cards in %s", async (locale, title, descriptionStart) => {
    state.locale = locale;
    const metadata = await homeMetadata();
    expect(metadata.title).toBe(title);
    expect(metadata.description).toMatch(new RegExp(`^${descriptionStart}`));
    expect(metadata.openGraph).toMatchObject({ title, description: metadata.description });
    expect(metadata.twitter).toMatchObject({ title, description: metadata.description });
    expect(metadata.alternates?.canonical).toBe("https://www.skillsetmind.com/");
  });

  it.each([
    ["en", "Reset your password. | SkillsetMind"],
    ["es", "Restablece tu contraseña. | SkillsetMind"],
  ] as const)("gives password recovery its own %s title", async (locale, title) => {
    state.locale = locale;
    const metadata = await recoveryMetadata();
    expect(metadata.title).toBe(title);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
