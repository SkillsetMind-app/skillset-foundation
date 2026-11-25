import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import type { TeacherCourse } from "@/domain/teacher-course";
import { publishTeacherCourse, subscribeToTeacherCourse } from "@/lib/data/teacher-courses";

// Mocks copied from course-readiness-screens.test.tsx: the SAME user and the
// SAME course on every render. A new object per render resubscribes the
// effects, enters a loop and hangs the machine.
const mocks = vi.hoisted(() => {
  const subscriptionCounts = new Map<string, number>();
  function fused<A extends unknown[]>(name: string, impl: (...args: A) => () => void) {
    return (...args: A) => {
      const calls = (subscriptionCounts.get(name) ?? 0) + 1;
      subscriptionCounts.set(name, calls);
      if (calls > 20) {
        throw new Error(`${name} inscrito ${calls} vezes: laco de render`);
      }
      return impl(...args);
    };
  }

  // Title, summary, category and one module ready; no lesson and no price.
  // Content 2 of 3 · page 2 of 2 (cover and results are optional) ·
  // sale 0 of 1 (verification not required and optional; free does not ask for a payout).
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [{ id: "m1", title: "Start here", lessons: [] }],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    fused,
    resetSubscriptionCounts: () => subscriptionCounts.clear(),
    course,
    user: { uid: "teacher-1" },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams("courseId=course-1&tab=review"),
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
  subscribeToTeacherCourse: vi.fn(mocks.fused(
    "subscribeToTeacherCourse",
    (_id: string, onData: (course: TeacherCourse) => void) => {
      onData(mocks.course);
      return () => undefined;
    },
  )),
  subscribeToTeacherCourses: mocks.fused(
    "subscribeToTeacherCourses",
    (_uid: string, onData: (courses: TeacherCourse[]) => void) => {
      onData([mocks.course]);
      return () => undefined;
    },
  ),
  publishTeacherCourse: vi.fn(),
  updateTeacherCourseBuilder: vi.fn(),
  setOwnCourseFeatured: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: mocks.fused(
    "subscribeToUserProfile",
    (_uid: string, onData: (profile: unknown) => void) => {
      onData({ creatorVerificationStatus: "none", currentPlanId: "free" });
      return () => undefined;
    },
  ),
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: vi.fn(() => () => undefined),
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

vi.mock("@/components/teacher/course-asset-uploader", () => ({
  CourseAssetUploader: () => null,
}));

vi.mock("@/components/teacher/course-overview-panel", () => ({
  CourseOverviewPanel: () => null,
}));

// The group title is a <p> with the name in a <span> and the count as loose
// text; getByText only reads direct text nodes, so the comparison is on the
// whole textContent of the <p>.
function groupTitle(text: string) {
  return screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);
}

const copy = {
  en: {
    groups: ["Content saved · 2 of 3", "Page prepared · 2 of 2", "Sale available · 0 of 1"],
    banner: "Students see it after you publish.",
    link: "Manage product",
  },
  es: {
    groups: ["Contenido guardado · 2 de 3", "Página preparada · 2 de 2", "Venta disponible · 0 de 1"],
    banner: "Los estudiantes lo ven después de publicarlo.",
    link: "Gestionar producto",
  },
} as const;

// Hotmart separates saved content, prepared page and available sale; our
// bar added up all three. And its editor warns "this product is not
// published" while it is a draft. Nothing here blocks publishing: it is a label.
describe("publishing checklist in three blocks and a draft banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("section");
    mocks.searchParams.set("courseId", "course-1");
    mocks.searchParams.set("tab", "review");
  });

  it.each(["en", "es"] as const)("builder in %s: three titles with a count, banner and link to the panel", async (locale) => {
    render(
      <I18nProvider initialLocale={locale}>
        <CourseBuilderStudio />
      </I18nProvider>,
    );
    await screen.findByRole("heading", { name: mocks.course.title });

    for (const title of copy[locale].groups) {
      expect(groupTitle(title)).toBeInTheDocument();
    }
    // Each item stays in the list, inside its own block.
    const review = document.getElementById("builder-sec-review")!;
    expect(review.querySelector('[data-readiness-group="content"]')).toHaveTextContent(/Course title|Título del curso/);
    expect(review.querySelector('[data-readiness-group="content"]')).toHaveTextContent(/Lesson|Lección/);
    expect(review.querySelector('[data-readiness-group="page"]')).toHaveTextContent(/Cover image|Imagen de portada/);
    expect(review.querySelector('[data-readiness-group="sale"]')).toHaveTextContent(/Pricing|Precios/);

    // The blue banner repeated the "Draft" badge: now it is a short sentence next to it,
    // and the path to the panel is the "Manage product" of the same header.
    const banner = screen.getByText(copy[locale].banner);
    expect(banner.closest(".course-builder-hero")).not.toBeNull();
    const link = screen.getByRole("link", { name: copy[locale].link });
    expect(link).toHaveAttribute("href", "/teach/courses/course-1/manage");

    // Grouping does not touch the lock: the same course still cannot be published.
    expect(screen.getByRole("button", { name: /Publish product|Publicar producto/ })).toBeDisabled();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it.each([
    ["builder", "mt-5", "gap-6"],
    ["hub", "mt-4", "gap-5"],
  ] as const)("%s: groups and item lists have shrinkable tracks while keeping caller spacing", async (surface, margin, gap) => {
    render(surface === "builder" ? <CourseBuilderStudio /> : <CourseManageHub courseId="course-1" />);
    await screen.findByRole("heading", { name: mocks.course.title });
    const groups = document.querySelectorAll<HTMLElement>("[data-readiness-group]");
    expect(groups).toHaveLength(3);
    // Structural guard, not a jsdom geometry claim: both nested grids must
    // have a zero minimum while each caller keeps its own margin and gap.
    expect(groups[0].parentElement).toHaveClass("grid", "grid-cols-1", margin, gap);
    for (const group of groups) {
      expect(within(group).getByRole("list")).toHaveClass("grid", "grid-cols-1", "gap-3");
    }
    expect(document.querySelectorAll("[data-readiness-group] li")).toHaveLength(9);
  });

  it("published course: the blocks stay, the banner goes away", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, status: "published" });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    render(
      <I18nProvider initialLocale="en">
        <CourseBuilderStudio />
      </I18nProvider>,
    );
    await screen.findByRole("heading", { name: mocks.course.title });

    expect(groupTitle(copy.en.groups[0])).toBeInTheDocument();
    expect(screen.queryByText(copy.en.banner)).not.toBeInTheDocument();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
  });

  it("product panel: the same list in three blocks, with the verification link in the sale block", async () => {
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");

    const list = screen.getByText("Publish checklist").closest("section") ?? document.body;
    for (const title of copy.en.groups) {
      expect(within(list).getByText((_, el) => el?.tagName === "P" && el.textContent === title)).toBeInTheDocument();
    }
    const sale = list.querySelector<HTMLElement>('[data-readiness-group="sale"]')!;
    expect(within(sale).getByRole("link", { name: "Open verification" })).toHaveAttribute("href", "/teach/verification");
    expect(within(sale).getByText("Set a price above $0, or choose Free.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
  });
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));
