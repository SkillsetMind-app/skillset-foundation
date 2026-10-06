import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import type { TeacherCourse } from "@/domain/teacher-course";

// Os links de divulgacao sao o que o criador cola em anuncio, story e bio.
// Faltava o terceiro: a vitrine publica dele. Este arquivo prova que os tres
// cards existem, que cada um tem o trio de botoes, e que o endereco da vitrine
// sai na mesma base publica da pagina do produto.

const mocks = vi.hoisted(() => {
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "published",
    modules: [{ id: "m1", title: "Start here", lessons: [] }],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    course,
    // O MESMO objeto em todo render: um usuario novo por render reinscreve os
    // efeitos e entra em laco.
    user: { uid: "teacher-1" },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams("section=links"),
    publicProfile: { username: "ana.souza" } as { username: string | null } | null,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: (_id: string, onData: (course: TeacherCourse) => void) => {
    onData(mocks.course);
    return () => undefined;
  },
  subscribeToTeacherCourses: (_uid: string, onData: (courses: TeacherCourse[]) => void) => {
    onData([mocks.course]);
    return () => undefined;
  },
  setOwnCourseFeatured: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (profile: unknown) => void) => {
    onData({ creatorVerificationStatus: "none", currentPlanId: "free" });
    return () => undefined;
  },
  getPublicProfile: async () => mocks.publicProfile,
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

// O painel do produto le pedidos, matriculas, cupons e avaliacoes. Nada disso
// entra na secao de links e tem prova propria em course-overview-panel.test.tsx.
vi.mock("@/components/teacher/course-overview-panel", () => ({
  CourseOverviewPanel: () => null,
}));

afterEach(() => cleanup());

function renderLinks() {
  return render(
    <I18nProvider initialLocale="en">
      <CourseManageHub courseId="course-1" />
    </I18nProvider>,
  );
}

describe("promo links section", () => {
  it("offers checkout, product page and storefront, each with the same three actions", () => {
    renderLinks();

    for (const label of ["Checkout", "Product page", "Storefront"]) {
      expect(screen.getByRole("button", { name: `Copy ${label} link` })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: `Open ${label}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Share ${label}` })).toBeInTheDocument();
    }

    // Tres cards, nem um a mais: cada card tem exatamente um "Copy ... link".
    expect(screen.getAllByRole("button", { name: /^Copy .+ link$/ })).toHaveLength(3);
  });

  it("publishes the storefront of the course owner on the same public base as the product page", async () => {
    mocks.publicProfile = null;
    renderLinks();

    // A pagina do produto define a base publica; a vitrine tem de sair na mesma.
    const productPage = screen
      .getByRole("link", { name: "Open Product page" })
      .getAttribute("href")!;
    const base = productPage.slice(0, productPage.indexOf("/courses/"));
    expect(base).toBe("https://www.skillsetmind.com");

    // Sem @ no perfil público: o endereço pelo uid.
    const storefront = `${base}/instructors/${mocks.course.ownerId}`;
    expect(await screen.findByText(storefront)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Storefront" })).toHaveAttribute(
      "href",
      storefront,
    );
  });

  // O link que o criador copia para a bio do Instagram é o /@usuario.
  it("uses the creator's @handle when the public profile has one", async () => {
    mocks.publicProfile = { username: "ana.souza" };
    renderLinks();

    expect(await screen.findByText("https://www.skillsetmind.com/@ana.souza")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Storefront" })).toHaveAttribute(
      "href",
      "https://www.skillsetmind.com/@ana.souza",
    );
  });
});
