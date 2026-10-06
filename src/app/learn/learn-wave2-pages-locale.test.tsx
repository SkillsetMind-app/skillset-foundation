import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LearnEventsPage from "@/app/learn/events/page";
import LearnCommunityPage from "@/app/learn/community/page";
import LearnWishlistPage from "@/app/learn/wishlist/page";
import LearnCredentialsPage from "@/app/learn/credentials/page";
import LearnMessagesPage from "@/app/learn/messages/page";
import LoadingCourse from "@/app/learn/courses/[slug]/loading";
import WelcomePage, { generateMetadata } from "@/app/welcome/page";
import OnboardingPage from "@/app/onboarding/page";
import { LearnCoursePage } from "@/components/learn/learn-course-page";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

const mocks = vi.hoisted(() => ({ locale: "es", refresh: vi.fn(), cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
// Only auth/data boundaries and unrelated children are replaced. The server
// translator, cookie resolution, provider, dictionaries and Suspense are real.
vi.mock("@/components/auth/protected-surface", () => ({ ProtectedSurface: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/platform/platform-shell", () => ({
  PlatformShell: ({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) => <main><p>{eyebrow}</p><h1>{title}</h1><p>{description}</p>{children}</main>,
}));
vi.mock("@/components/auth/auth-shell", () => ({
  AuthShell: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("@/components/learn/member-area-shell", () => ({ MemberAreaShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/learn/learn-events-hub", () => ({ LearnEventsHub: () => null }));
vi.mock("@/components/learn/learn-community-hub", () => ({ LearnCommunityHub: () => null }));
vi.mock("@/components/learn/learner-wishlist", () => ({ LearnerWishlist: () => null }));
vi.mock("@/components/learn/learn-credentials-hub", () => ({ LearnCredentialsHub: () => null }));
vi.mock("@/components/learn/student-messages-inbox", () => ({ StudentMessagesInbox: () => null }));
vi.mock("@/components/learn/enrolled-course-workspace", () => ({ EnrolledCourseWorkspace: () => null }));
vi.mock("@/components/learn/creator-course-workspace", () => {
  const pending = new Promise(() => {});
  return { CreatorCourseWorkspace: () => { throw pending; } };
});
vi.mock("@/components/auth/onboarding-wizard", () => {
  const pending = new Promise(() => {});
  return { OnboardingWizard: () => { throw pending; } };
});
vi.mock("@/components/auth/onboarding-choice", () => {
  const pending = new Promise(() => {});
  return { OnboardingChoice: () => { throw pending; } };
});
vi.mock("@/lib/data/catalog", () => ({ getCourseBySlug: () => null }));
vi.mock("@/lib/learn/server/member-area", () => ({ getMemberArea: async () => ({ brand: null, theme: "dark" }) }));
vi.mock("@/lib/posthog/page-trackers", () => ({
  CourseViewedTracker: () => null,
  PurchaseCompletedTracker: () => null,
}));

beforeEach(() => {
  mocks.locale = "es";
  mocks.cookies.mockResolvedValue({ get: (name: string) => name === LOCALE_COOKIE ? { value: mocks.locale } : undefined });
});
afterEach(cleanup);

describe("learner routes read the real locale cookie", () => {
  it.each([
    [LearnEventsPage, "Tu calendario de aprendizaje en vivo.", "Your live learning schedule."],
    [LearnCommunityPage, "La comunidad acompaña tu aprendizaje.", "Community stays connected to enrolled learning."],
    [LearnWishlistPage, "Tu lista de cursos favoritos.", "Your course wishlist."],
    [LearnCredentialsPage, "Sigue tu progreso hacia la verificación de SkillsetMind.", "Track your SkillsetMind Verified progress."],
    [LearnMessagesPage, "Tus conversaciones con los profesores.", "Your conversations with teachers."],
  ] as const)("localizes the page heading in both cookie locales", async (Page, spanish, english) => {
    const view = render(await Page());
    expect(screen.getByRole("heading", { name: spanish })).toBeVisible();
    expect(view.container.textContent).not.toContain("learnWave2.");
    mocks.locale = "en";
    view.rerender(await Page());
    expect(screen.getByRole("heading", { name: english })).toBeVisible();
    expect(view.container.textContent).not.toContain("learnWave2.");
  });

  it("localizes welcome Suspense and metadata without changing indexing policy", async () => {
    render(<I18nProvider initialLocale="es">{await WelcomePage()}</I18nProvider>);
    expect(screen.getByRole("heading", { name: "Preparando la configuración inicial" })).toBeVisible();
    expect(screen.getByText("Un momento. SkillsetMind está preparando todo.")).toBeVisible();
    expect(await generateMetadata()).toEqual({ title: "Configura tu cuenta | SkillsetMind", robots: { index: false, follow: false } });
  });

  it("localizes onboarding Suspense without adding another page heading", async () => {
    render(<I18nProvider initialLocale="es">{await OnboardingPage()}</I18nProvider>);
    expect(screen.getByText("Preparando la configuración inicial")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Preparando la configuración inicial" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  // Abrir um curso passava por ate quatro telas de espera diferentes — a da
  // rota pintada de escuro (os cursos nascem claros), a do Suspense, um cartao
  // branco e o esqueleto da sala. A da rota e a do Suspense agora sao a MESMA.
  it("shows one loading state: the route file and the published-course Suspense fallback match", async () => {
    const view = render(await LoadingCourse());
    expect(screen.getByRole("status")).toHaveTextContent("Cargando curso...");
    const route = view.container.querySelector("[aria-busy='true']")?.outerHTML;
    expect(route).toBeTruthy();
    expect(route).not.toMatch(/#0a0d12|#141923/i);
    view.rerender(await LearnCoursePage({ slug: "teacher-course", tab: "lesson" }));
    expect(view.container.querySelector("[aria-busy='true']")?.outerHTML).toBe(route);
    mocks.locale = "en";
    view.rerender(await LearnCoursePage({ slug: "teacher-course", tab: "materials" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading course...");
  });
});
