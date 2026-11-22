import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({ locale: "es" as "en" | "es", permissions: [] as string[], pending: new Promise<never>(() => {}) }));
vi.mock("@/lib/i18n/server", () => ({
  getServerTranslation: async () => ({ locale: mocks.locale, t: (key: string) => translate(getDictionary(mocks.locale), key) }),
}));
vi.mock("@/components/auth/protected-surface", () => ({
  ProtectedSurface: ({ children, permissions }: { children: ReactNode; permissions: string[] }) => {
    mocks.permissions = permissions;
    return children;
  },
}));
vi.mock("@/components/platform/platform-shell", () => ({ PlatformShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/teacher/teacher-builder-hub", () => ({ TeacherBuilderHub: () => { throw mocks.pending; } }));

import TeacherBuilderPage from "./builder/page";

afterEach(cleanup);
describe("builder route loading language", () => {
  it.each([
    ["en", "Loading course builder..."],
    ["es", "Cargando el constructor del curso..."],
  ] as const)("uses %s in the real Suspense fallback with the same permission", async (locale, text) => {
    mocks.locale = locale;
    render(await TeacherBuilderPage());
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(mocks.permissions).toEqual(["teacherStudio.manageCourses"]);
  });

  // Sem curso e a lista: o esqueleto do editor (etapas, formulario) aparecia
  // antes e trocava pelo da lista, dois pulos ate a tabela.
  it("draws the list skeleton for the product list and the editor skeleton for a course", async () => {
    mocks.locale = "en";
    const { unmount } = render(await TeacherBuilderPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("status")).toHaveAttribute("data-skeleton", "list");
    unmount();
    render(await TeacherBuilderPage({ searchParams: Promise.resolve({ courseId: "course-1" }) }));
    expect(screen.getByRole("status")).toHaveAttribute("data-skeleton", "editor");
    expect(screen.getByRole("status")).toHaveTextContent("Loading course builder...");
  });
});
