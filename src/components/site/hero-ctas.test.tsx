import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeroCtas } from "@/components/site/hero-ctas";
import { RealCoursesProvider } from "@/components/site/real-courses";
import type { SkillsetUser } from "@/domain/auth";

// Visitante logado: o hero troca as chamadas de conversão por "ir ao painel" e
// "explorar cursos". O segundo só existe enquanto a loja tem curso real.
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "u-1", email: "person@example.com", displayName: "Test Person", roles: ["student"] } as SkillsetUser,
  }),
}));

afterEach(cleanup);

describe("HeroCtas (logado)", () => {
  it("leva à loja quando há curso real publicado", () => {
    render(<RealCoursesProvider value><HeroCtas /></RealCoursesProvider>);

    expect(screen.getByRole("link", { name: "Browse courses" })).toHaveAttribute("href", "/courses");
  });

  it("não leva à loja vazia: sobra só o painel", () => {
    render(<RealCoursesProvider value={false}><HeroCtas /></RealCoursesProvider>);

    expect(screen.queryByRole("link", { name: "Browse courses" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
