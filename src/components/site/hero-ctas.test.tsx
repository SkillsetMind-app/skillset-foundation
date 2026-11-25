import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeroCtas } from "@/components/site/hero-ctas";
import { RealCoursesProvider } from "@/components/site/real-courses";
import type { SkillsetUser } from "@/domain/auth";

// Signed-in visitor: the hero swaps the conversion calls for "go to the dashboard" and
// "explore courses". The second only exists while the storefront has a real course.
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "u-1", email: "person@example.com", displayName: "Test Person", roles: ["student"] } as SkillsetUser,
  }),
}));

afterEach(cleanup);

describe("HeroCtas (logado)", () => {
  it("links to the storefront when a real course is published", () => {
    render(<RealCoursesProvider value><HeroCtas /></RealCoursesProvider>);

    expect(screen.getByRole("link", { name: "Browse courses" })).toHaveAttribute("href", "/courses");
  });

  it("does not link to an empty storefront: only the dashboard is left", () => {
    render(<RealCoursesProvider value={false}><HeroCtas /></RealCoursesProvider>);

    expect(screen.queryByRole("link", { name: "Browse courses" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
