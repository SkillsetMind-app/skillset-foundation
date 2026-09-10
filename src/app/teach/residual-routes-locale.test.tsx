import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TeacherCouponsPage from "@/app/teach/coupons/page";
import TeacherMarketingPage from "@/app/teach/marketing/page";
import CourseManagePage from "@/app/teach/courses/[courseId]/manage/page";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({ locale: "en" as "en" | "es", suspended: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));
vi.mock("@/components/auth/protected-surface", () => ({
  ProtectedSurface: ({ children, permissions }: { children: ReactNode; permissions: string[] }) =>
    <div data-testid="gate" data-permissions={permissions.join(",")}>{children}</div>,
}));
vi.mock("@/components/platform/platform-shell", () => ({
  PlatformShell: ({ title, hideHeader, children }: { title: string; hideHeader: boolean; children: ReactNode }) =>
    <main data-title={title} data-hide-header={hideHeader}>{children}</main>,
}));
vi.mock("@/components/teacher/creator-marketing-hub", () => ({ CreatorMarketingHub: () => <div data-testid="marketing-hub" /> }));
vi.mock("@/components/teacher/course-manage-hub", () => ({
  CourseManageHub: ({ courseId }: { courseId: string }) => {
    if (mocks.suspended) throw new Promise<void>(() => {});
    return <div data-testid="manage-hub" data-course-id={courseId} />;
  },
}));

beforeEach(() => { mocks.suspended = false; });
afterEach(cleanup);

describe("residual teacher routes with real server translation and I18nProvider", () => {
  it("requires all residual strings in both real dictionaries without fragment injection", () => {
    for (const key of ["couponsTitle", "couponsDescription", "openCourses", "manageLoading"]) {
      const path = `teacherRouteResidual.${key}`;
      const english = translate(getDictionary("en"), path);
      const spanish = translate(getDictionary("es"), path);
      expect(english).not.toBe(path);
      expect(spanish).not.toBe(path);
      expect(spanish).not.toBe(english);
    }
  });

  it.each(["en", "es"] as const)("localizes the coupons signpost in %s without changing the destination or gate", async locale => {
    mocks.locale = locale;
    render(<I18nProvider initialLocale={locale}>{await TeacherCouponsPage()}</I18nProvider>);
    expect(screen.getByRole("heading")).toHaveTextContent(locale === "es"
      ? "Los cupones se gestionan en el panel de cada curso."
      : "Coupons live in each course's central.");
    expect(screen.getByText(locale === "es" ? "Estudio del Profesor" : "Teacher Studio")).toBeInTheDocument();
    const description = translate(getDictionary(locale), "teacherRouteResidual.couponsDescription");
    expect(screen.getByText(description)).toHaveTextContent(locale === "es" ? "antes del pago" : "before payment");
    const link = screen.getByRole("link", { name: locale === "es" ? "Abrir mis cursos" : "Open my courses" });
    expect(link).toHaveAttribute("href", "/teach/builder");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("main")).toHaveAttribute("data-title", locale === "es" ? "Cupones y promociones" : "Coupons & promotions");
    expect(screen.getByRole("main")).toHaveAttribute("data-hide-header", "true");
    expect(screen.getByTestId("gate")).toHaveAttribute("data-permissions", "teacherStudio.access");
  });

  it.each(["en", "es"] as const)("keeps the marketing hub, hidden header and canonical access permission in %s", async locale => {
    mocks.locale = locale;
    render(<I18nProvider initialLocale={locale}>{await TeacherMarketingPage()}</I18nProvider>);
    expect(screen.getByRole("main")).toHaveAttribute("data-title", translate(getDictionary(locale), "teach.marketing.eyebrow"));
    expect(screen.getByRole("main")).toHaveAttribute("data-hide-header", "true");
    expect(screen.getByTestId("marketing-hub")).toBeInTheDocument();
    expect(screen.getByTestId("gate")).toHaveAttribute("data-permissions", "teacherStudio.access");
  });

  it.each(["en", "es"] as const)("keeps the literal course ID and localized hidden management title in %s", async locale => {
    mocks.locale = locale;
    render(<I18nProvider initialLocale={locale}>{await CourseManagePage({ params: Promise.resolve({ courseId: "course-$&" }) })}</I18nProvider>);
    expect(screen.getByRole("main")).toHaveAttribute("data-title", locale === "es" ? "Gesti\u00f3n del curso" : "Course management");
    expect(screen.getByRole("main")).toHaveAttribute("data-hide-header", "true");
    expect(screen.getByTestId("manage-hub")).toHaveAttribute("data-course-id", "course-$&");
    expect(screen.getByTestId("gate")).toHaveAttribute("data-permissions", "teacherStudio.manageCourses");
  });

  it.each(["en", "es"] as const)("localizes the real Suspense fallback in %s", async locale => {
    mocks.locale = locale;
    mocks.suspended = true;
    render(<I18nProvider initialLocale={locale}>{await CourseManagePage({ params: Promise.resolve({ courseId: "course-$&" }) })}</I18nProvider>);
    expect(screen.getByText(locale === "es" ? "Cargando la gesti\u00f3n del curso..." : "Loading course management...")).toBeInTheDocument();
    expect(screen.queryByTestId("manage-hub")).toBeNull();
  });
});
