import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeFaq } from "@/components/site/home-faq";
import { helpFaqCategories } from "@/data/help-faq";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";

// Server component: the language comes from the cookie.
const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.locale }) }) }));

afterEach(() => {
  cleanup();
  state.locale = "en";
});

const dictionaries = [["en", en], ["es", es]] as const;

// The chosen questions, in home order: [category of /help, position].
const expected = [
  ["plans", 0],
  ["payouts", 0],
  ["plans", 2],
  ["refunds", 0],
  ["course-creation", 0],
  ["integrations", 0],
] as const;

const at = (dict: object, path: string) =>
  path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], dict) as string;

describe("home frequently asked questions", () => {
  it.each(dictionaries)("in %s shows the help center questions and answers, without rewriting", async (locale, dict) => {
    state.locale = locale;
    const { container } = render(await HomeFaq());

    expect(container.querySelector("h2")?.textContent).toBe(dict.publicPages.pricing.common_questions);
    expect(container.textContent).toContain(dict.footer.helpCenter);

    const items = [...container.querySelectorAll("details")];
    expect(items).toHaveLength(expected.length);
    items.forEach((item, position) => {
      const [category, index] = expected[position];
      const key = `publicPages.helpFaq.${category}.items.${index}`;
      // Closed on arrival: whoever wants to, opens them.
      expect(item).not.toHaveAttribute("open");

      const summary = item.querySelector("summary")!;
      expect(summary.textContent).toBe(at(dict, `${key}.q`));
      expect(item.querySelector("p")?.textContent).toBe(at(dict, `${key}.a`));

      // The answer ends with the link to its category on /help, and the link
      // carries the question as its description.
      const links = item.querySelectorAll("a");
      expect(links).toHaveLength(1);
      expect(item.lastElementChild?.lastElementChild).toBe(links[0]);
      expect(links[0]).toHaveAttribute("href", `/help#${category}`);
      expect(links[0].textContent).toBe(dict.home.faq.more);
      const describedBy = container.querySelector(`#${links[0].getAttribute("aria-describedby")}`);
      expect(describedBy?.textContent).toBe(at(dict, `${key}.q`));
      expect(summary.contains(describedBy)).toBe(true);
    });
  });

  // The link only works if /help has the category and the question: the page builds
  // the sections from helpFaqCategories, with the category id.
  it("each question exists on /help, in the category the link points to", () => {
    for (const [category, index] of expected) {
      const section = helpFaqCategories.find((item) => item.id === category);
      expect(section, category).toBeDefined();
      expect(section!.items[index], `${category}.${index}`).toBeDefined();
      // The same question that /help shows in English.
      expect(at(en, `publicPages.helpFaq.${category}.items.${index}.q`)).toBe(section!.items[index].q);
    }
  });

  // Without JavaScript: native <details>. The arrow rotates on open and only moves when
  // motion is allowed (motion-safe), at the house timings.
  it("opens and closes without JavaScript, and the arrow only moves when motion is allowed", async () => {
    const source = readFileSync(join(process.cwd(), "src/components/site/home-faq.tsx"), "utf8");
    expect(source).not.toContain('"use client"');
    expect(source).not.toMatch(/\bon[A-Z][a-zA-Z]*=/);

    const { container } = render(await HomeFaq());
    for (const chevron of container.querySelectorAll("summary svg")) {
      const classes = chevron.getAttribute("class") ?? "";
      expect(classes).toContain("group-open:rotate-180");
      expect(classes).toContain("motion-safe:transition-transform");
      expect(classes).toContain("motion-safe:duration-[var(--duration-base)]");
      expect(classes.split(" ")).not.toContain("transition-transform");
    }
    // Touch target of 48px or more on the question and the link.
    for (const summary of container.querySelectorAll("summary")) expect(summary).toHaveClass("min-h-14", "text-lg");
    for (const link of container.querySelectorAll("details a")) expect(link).toHaveClass("min-h-12");
  });
});
