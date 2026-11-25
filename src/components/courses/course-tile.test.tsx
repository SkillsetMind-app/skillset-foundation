import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CourseTile, courseCardBadge } from "@/components/courses/course-tile";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { CourseCard } from "@/lib/data/catalog";

const language = vi.hoisted(() => ({ locale: "en" as "en" | "es" }));
vi.mock("@/components/i18n/i18n-provider", () => ({ useTranslation: () => ({ locale: language.locale, t: (key: string) => translate(getDictionary(language.locale), key) }) }));
beforeEach(() => { language.locale = "en"; });

afterEach(cleanup);

function renderTile(overrides: Partial<Parameters<typeof CourseTile>[0]> = {}) {
  return render(
    <CourseTile
      href="/courses/focus"
      title="Deep Focus Systems"
      image="/brand/logo-mark.png"
      summary="Build a repeatable focus practice."
      category="Performance"
      meta="8 lessons"
      priceLabel="$149.00"
      {...overrides}
    />,
  );
}

describe("CourseTile", () => {
  it("makes the whole card a link, not only the button", () => {
    const { container } = renderTile();

    const link = screen.getByRole("link", { name: "Deep Focus Systems" });
    // Stretched link: the ::after covers the card, so clicking any corner
    // navigates. Before, only the "View course" button took you anywhere.
    expect(link).toHaveClass("marketplace-card__link");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    // "View course" became a footer label, not a second destination.
    expect(
      screen.queryByRole("link", { name: /view course/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the price only once", () => {
    renderTile();

    expect(screen.getAllByText("$149.00")).toHaveLength(1);
  });

  it("shows at most one badge", () => {
    const { container } = renderTile({ badge: "Free preview" });

    const badges = container.querySelectorAll(".marketplace-card__tag");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("Free preview");
  });

  it("no badge when there is nothing to say", () => {
    const { container } = renderTile({ badge: null });

    expect(container.querySelectorAll(".marketplace-card__tag")).toHaveLength(0);
  });

  it("saving does not navigate: the button stays outside the link, not inside it", () => {
    const onSave = vi.fn();
    const { container } = renderTile({
      overlay: (
        <button type="button" onClick={onSave} aria-label="Save to wishlist">
          save
        </button>
      ),
    });

    const save = screen.getByRole("button", { name: "Save to wishlist" });
    expect(save.closest("a")).toBeNull();

    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    // The click on the button must not have triggered the card link.
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/courses/focus",
    );
  });

  it("shows who teaches and the rating", () => {
    renderTile({
      instructor: { name: "Ana Prado", photoURL: null },
      rating: { average: 4.8, count: 12 },
    });

    expect(screen.getByText("Ana Prado")).toBeInTheDocument();
    expect(screen.getByText("4.8")).toBeInTheDocument();
    expect(screen.getByText("(12)")).toBeInTheDocument();
  });

  it("verified teacher: only the badge, with an accessible name, and no button inside the link", () => {
    renderTile({ instructor: { name: "Ana Prado", photoURL: null, verified: true } });

    expect(screen.getByRole("img", { name: "Verified professional" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verified professional" })).toBeNull();
    expect(screen.queryByText("Verified professional")).toBeNull();
  });

  it("no verification, no badge", () => {
    renderTile({ instructor: { name: "Ana Prado", photoURL: null, verified: false } });

    expect(screen.queryByRole("img", { name: "Verified professional" })).toBeNull();
  });

  it("does not invent a rating when nobody has rated", () => {
    renderTile({ rating: { average: 0, count: 0 } });

    expect(screen.queryByText(/^\(\d+\)$/)).not.toBeInTheDocument();
  });
});

describe("courseCardBadge", () => {
  const base = { ratingCount: 3 } as CourseCard;

  it("prefers the free preview", () => {
    expect(
      courseCardBadge({ ...base, freePreviewHref: "/courses/x#free-preview" }),
    ).toBe("Free preview");
  });

  it("paid featured placement comes before the preview and the new one: the purchased position is stated", () => {
    expect(
      courseCardBadge({ ...base, featured: true, freePreviewHref: "/courses/x#free-preview", ratingCount: 0 }),
    ).toBe("Featured (paid placement)");
  });

  it("calls a course with no ratings new", () => {
    expect(courseCardBadge({ ...base, ratingCount: 0 })).toBe("New");
  });

  it("does not use Published as a badge: it is internal vocabulary", () => {
    expect(courseCardBadge(base)).toBeNull();
  });
});

describe("one course card, not three", () => {
  // The three screens that list courses each drew the card their own way.
  // This test fails if any of them goes back to mounting its own.
  it.each([
    ["home", "src/components/site/featured-courses.tsx"],
    ["catalogo", "src/components/courses/course-marketplace.tsx"],
    ["vitrine do professor", "src/components/instructors/instructor-profile-view.tsx"],
  ])("%s uses CourseTile", (_surface, path) => {
    const source = readFileSync(path, "utf8");

    expect(source).toContain("course-tile");
    expect(source).toContain("<CourseTile");
    // None of them mounts the card body on its own.
    expect(source).not.toContain("marketplace-card__title");
    expect(source).not.toContain("marketplace-card__body");
  });
});

it("updates derived card copy after a language switch while preserving authored content and URL", () => {
  const props = { href: "/courses/focus?offer=SPRING", title: "Deep Focus Systems", summary: "A lesson author's own summary", image: "/brand/logo-mark.png", courseData: { lessonCount: 2, priceAmountMinor: 14900, currency: "USD", freePreviewHref: "/courses/focus#free-preview" } };
  const { rerender } = render(<CourseTile {...props} />);
  expect(screen.getByText("2 lessons")).toBeInTheDocument();
  language.locale = "es";
  rerender(<CourseTile {...props} />);
  expect(screen.getByText("2 lecciones")).toBeInTheDocument();
  expect(screen.getByText("Vista previa gratuita")).toBeInTheDocument();
  expect(screen.getByText("Ver curso")).toBeInTheDocument();
  expect(screen.getByText("A lesson author's own summary")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: props.title })).toHaveAttribute("href", props.href);
});

// Paid featured placement: the buyer sees that the position was paid for, in both languages.
it("labels a featured course as paid placement, in English and Spanish", () => {
  const props = { href: "/courses/focus", title: "Deep Focus Systems", image: "/brand/logo-mark.png", courseData: { lessonCount: 2, priceAmountMinor: 14900, currency: "USD", freePreviewHref: "/courses/focus#free-preview", featured: true } };
  const { rerender } = render(<CourseTile {...props} />);
  expect(screen.getByText("Featured (paid placement)")).toBeInTheDocument();
  expect(screen.queryByText("Free preview")).not.toBeInTheDocument();
  language.locale = "es";
  rerender(<CourseTile {...props} />);
  expect(screen.getByText("Destacado (posición pagada)")).toBeInTheDocument();
});
