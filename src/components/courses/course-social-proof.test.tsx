import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { CourseReview } from "@/domain/course-review";
import { CourseReviewsSection } from "./course-social-proof";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "es", subscribe: vi.fn() }));
vi.mock("@/components/i18n/i18n-provider", () => ({ useTranslation: () => ({ locale: state.locale, t: (key: string) => translate(getDictionary(state.locale), key) }) }));
vi.mock("@/lib/data/course-reviews", () => ({ subscribeToCourseReviews: state.subscribe }));

it("translates loaded review labels and dates without changing authors' reviews or resubscribing", async () => {
  state.subscribe.mockImplementation((_id: string, next: (reviews: CourseReview[]) => void) => {
    next([{ id: "review", courseId: "focus", authorName: "Ana", rating: 5, body: "These are my own words.", status: "published", createdAt: { toMillis: () => Date.UTC(2026, 0, 15) } }]);
    return () => {};
  });
  const { rerender } = render(<CourseReviewsSection courseId="focus" />);
  await screen.findByText("Learner reviews");
  state.locale = "es";
  rerender(<CourseReviewsSection courseId="focus" />);
  expect(screen.getByText("Reseñas de estudiantes")).toBeInTheDocument();
  expect(screen.getByText("1 reseña de estudiantes inscritos")).toBeInTheDocument();
  expect(screen.getAllByRole("img", { name: "Calificación: 5,0 de 5" })).toHaveLength(2);
  expect(screen.getByText("ene 2026")).toBeInTheDocument();
  expect(screen.getByText("These are my own words.")).toBeInTheDocument();
  expect(state.subscribe).toHaveBeenCalledTimes(1);
});
