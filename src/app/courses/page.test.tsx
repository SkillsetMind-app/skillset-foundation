import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CoursesPage, { generateMetadata } from "@/app/courses/page";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

const state = vi.hoisted(() => ({ hasCourses: true, locale: "en" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === LOCALE_COOKIE ? { value: state.locale } : undefined) }),
}));
// Is there a published real course (without the internal test ones)? Contract of hasRealPublishedCourse.
vi.mock("@/lib/data/server/public-course", () => ({ hasRealPublishedCourse: async () => state.hasCourses, isMarketplaceOpen: async () => false }));
// The bar and the footer have their own tests; the store is a client and fetches in the browser.
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/courses/course-marketplace", () => ({ CourseMarketplace: () => <div data-testid="marketplace" /> }));

afterEach(() => {
  cleanup();
  state.hasCourses = true;
  state.locale = "en";
});

describe("/courses", () => {
  it("stays out of the index while there is no real course, but the links are still followed", async () => {
    state.hasCourses = false;
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
  });

  it("is indexable as soon as a real course exists", async () => {
    expect((await generateMetadata()).robots).toEqual({ index: true, follow: true });
  });

  it("empty, says the courses are on the way and points to creators, with no storefront", async () => {
    state.hasCourses = false;
    render(await CoursesPage());

    expect(screen.getByRole("heading", { level: 1, name: "The first courses are on the way." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Creator overview" })).toHaveAttribute("href", "/for-creators");
    expect(screen.queryByTestId("marketplace")).not.toBeInTheDocument();
    expect(screen.queryByText("Find the right course.")).not.toBeInTheDocument();
  });

  it("empty, in Spanish", async () => {
    state.hasCourses = false;
    state.locale = "es";
    render(await CoursesPage());

    expect(screen.getByRole("heading", { level: 1, name: "Los primeros cursos están en camino." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Información para creadores" })).toHaveAttribute("href", "/for-creators");
  });

  it("with a real course, keeps the usual store", async () => {
    render(await CoursesPage());

    expect(screen.getByRole("heading", { level: 1, name: "Find the right course." })).toBeInTheDocument();
    expect(screen.getByTestId("marketplace")).toBeInTheDocument();
  });
});
