import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Page, { generateMetadata } from "./page";
vi.mock("@/lib/data/server/public-course", () => ({ getPublicCourseByRef: async () => ({ title: "Focus", summary: "Build focus", coverImageUrl: null }) }));
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
vi.mock("@/components/courses/creator-course-detail", () => ({ CreatorCourseDetail: (props: { checkoutOnly?: boolean; courseIdOverride?: string; hideHeader?: boolean }) => <div data-testid="checkout" data-compact={props.checkoutOnly} data-course={props.courseIdOverride} data-hide-header={props.hideHeader} /> }));
afterEach(cleanup);
it("renders public title and compact checkout with the route reference", async () => {
  render(await Page({ params: Promise.resolve({ slug: "focus" }) }));
  expect(screen.getByRole("heading", { name: "Focus" })).toBeInTheDocument();
  expect(screen.getByTestId("checkout")).toHaveAttribute("data-compact", "true");
  expect(screen.getByTestId("checkout")).toHaveAttribute("data-course", "focus");
  expect(screen.getByTestId("checkout")).toHaveAttribute("data-hide-header", "true");
});
it("uses public course metadata and the permanent checkout canonical", async () => {
  const metadata = await generateMetadata({ params: Promise.resolve({ slug: "focus" }) });
  expect(metadata.title).toContain("Focus");
  expect(metadata.title).toContain("Pago");
  expect(metadata.description).toBe("Build focus");
  expect(metadata.alternates?.canonical).toBe("https://www.skillsetmind.com/courses/focus/checkout");
});

vi.mock("@/lib/i18n/server", () => ({ getServerTranslation: async () => ({ locale: "es", t: (key: string) => translate(getDictionary("es"), key) }) }));
