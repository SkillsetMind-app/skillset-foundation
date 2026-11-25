import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InstructorDetailPage, { generateMetadata } from "@/app/instructors/[slug]/page";
import { RealCoursesProvider } from "@/components/site/real-courses";
import type { PublicProfile } from "@/domain/user-profile";
import type { CreatorCourse } from "@/lib/data/server/public-profile";

const mocks = vi.hoisted(() => ({
  getPublicProfileByRef: vi.fn<(ref: string) => Promise<PublicProfile | null>>(),
  listCreatorCourses: vi.fn<(uid: string) => Promise<CreatorCourse[] | null>>(),
  // Like Next: notFound() interrupts rendering by throwing.
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  locale: "en",
}));

vi.mock("@/lib/data/server/public-profile", () => ({
  getPublicProfileByRef: mocks.getPublicProfileByRef,
  listCreatorCourses: mocks.listCreatorCourses,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));

const ana: PublicProfile = {
  uid: "6f1c2a7e-0000-4000-8000-000000000001",
  displayName: "Ana Souza",
  username: "ana.souza",
  photoURL: null,
  bio: "Coach de carreira há doze anos. ".repeat(10).trim(),
  credentials: ["ICF Associate Certified Coach"],
  storefront: { showcase: { tagline: "Career coach for first-time managers", featuredCourseId: "c-2" } },
  updatedAt: "2026-10-05T12:00:00.000Z",
};

const course = (id: string, title: string, extra: Partial<CreatorCourse> = {}): CreatorCourse => ({
  id,
  href: `/courses/${id}`,
  title,
  coverImageUrl: null,
  free: false,
  priceAmountMinor: 4900,
  currency: "USD",
  ratingAverage: 0,
  ratingCount: 0,
  ...extra,
});

const courses = [
  course("c-1", "Alpha", { free: true, priceAmountMinor: null }),
  course("c-2", "Bravo", { ratingAverage: 4.5, ratingCount: 4 }),
];

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function renderPage(slug: string, hasRealCourses = true) {
  const page = await InstructorDetailPage(params(slug));
  return render(<RealCoursesProvider value={hasRealCourses}>{page}</RealCoursesProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = "en";
  mocks.getPublicProfileByRef.mockImplementation(async (ref) =>
    ref === "@ana.souza" || ref === ana.uid ? ana : null,
  );
  mocks.listCreatorCourses.mockResolvedValue(courses);
});
afterEach(cleanup);

describe("metadata do perfil", () => {
  it("title, description, canonical and card are the teacher's", async () => {
    const metadata = await generateMetadata(params("@ana.souza"));

    expect(metadata.title).toBe("Ana Souza (@ana.souza) · Career coach for first-time managers | SkillsetMind");
    expect(metadata.description).toBe("Career coach for first-time managers");
    expect(metadata.alternates?.canonical).toBe("https://www.skillsetmind.com/@ana.souza");
    expect(metadata.openGraph?.images).toEqual([
      // ?v= changes when the profile changes: WhatsApp and Facebook keep the card
      // by URL, and without it the new photo never showed up.
      { url: `https://www.skillsetmind.com/instructors/${ana.uid}/opengraph-image?v=2026-10-05T12%3A00%3A00.000Z` },
    ]);
  });

  it("a plan that removes the brand: the title does not end with '| SkillsetMind'", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({
      ...ana,
      storefront: { ...ana.storefront, branding: { hidePlatformBrand: true } },
    });
    const metadata = await generateMetadata(params("@ana.souza"));
    expect(metadata.title).toBe("Ana Souza (@ana.souza) · Career coach for first-time managers");
  });

  it("without a tagline, the description is the first ~155 characters of the bio", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({ ...ana, storefront: null });
    const metadata = await generateMetadata(params("@ana.souza"));

    expect(metadata.title).toBe("Ana Souza (@ana.souza) | SkillsetMind");
    expect(metadata.description).toMatch(/^Coach de carreira há doze anos\./);
    expect(metadata.description!.length).toBeLessThanOrEqual(156);
    expect(metadata.description).toMatch(/…$/);
  });

  it("the same profile through /instructors/{uid} declares /@usuario as canonical", async () => {
    const metadata = await generateMetadata(params(ana.uid));
    expect(metadata.alternates?.canonical).toBe("https://www.skillsetmind.com/@ana.souza");
  });

  it("without @, the canonical is still /instructors/{uid}", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({ ...ana, username: null });
    const metadata = await generateMetadata(params(ana.uid));
    expect(metadata.alternates?.canonical).toBe(`https://www.skillsetmind.com/instructors/${ana.uid}`);
  });

  it("the encoded @ (%40) finds the same profile", async () => {
    await generateMetadata(params("%40ana.souza"));
    expect(mocks.getPublicProfileByRef).toHaveBeenCalledWith("@ana.souza");
  });

  // A profile with no published course is a thin page: it stays out of the index until the
  // first course, but its links are still followed.
  it("without a published course: noindex, follow (by @ and by uid)", async () => {
    mocks.listCreatorCourses.mockResolvedValue([]);
    expect((await generateMetadata(params("@ana.souza"))).robots).toEqual({ index: false, follow: true });
    expect((await generateMetadata(params(ana.uid))).robots).toEqual({ index: false, follow: true });
  });

  it("with a published course: indexable", async () => {
    expect((await generateMetadata(params("@ana.souza"))).robots).toEqual({ index: true, follow: true });
  });

  // A read failure is not an empty profile: taking a profile with a course out of the index
  // over a database stumble would cost weeks of search.
  it("reading the courses failed: still indexable", async () => {
    mocks.listCreatorCourses.mockResolvedValue(null);
    expect((await generateMetadata(params("@ana.souza"))).robots).toEqual({ index: true, follow: true });
  });

  it("a read that failed does not invent a teacher: generic metadata and outside the index", async () => {
    mocks.getPublicProfileByRef.mockRejectedValue(new Error("database down"));
    const metadata = await generateMetadata(params("@ana.souza"));
    expect(metadata.title).toBe("Instructor | SkillsetMind");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("profile page", () => {
  it("a nonexistent @ or uid is a real 404", async () => {
    await expect(InstructorDetailPage(params("@ninguem"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(InstructorDetailPage(params("uid-inventado"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.listCreatorCourses).not.toHaveBeenCalled();
  });

  it("a read that failed becomes an error, never a 404", async () => {
    mocks.getPublicProfileByRef.mockRejectedValue(new Error("database down"));
    await expect(InstructorDetailPage(params("@ana.souza"))).rejects.toThrow("database down");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("follows the order of the bio link, from the header to the footer", async () => {
    const { container } = await renderPage("@ana.souza");

    const order = [...container.querySelectorAll("[data-section]")].map((node) => node.getAttribute("data-section"));
    expect(order).toEqual(["header", "primary", "courses", "proof", "about", "footer"]);

    expect(screen.getByRole("heading", { level: 1, name: "Ana Souza" })).toBeInTheDocument();
    expect(screen.getByText("@ana.souza")).toBeInTheDocument();
    // Main button = featured course (Bravo), not the first on the list.
    expect(container.querySelector('[data-section="primary"]')).toHaveAttribute("href", "/courses/c-2");
    expect(container.querySelector('[data-section="primary"]')).toHaveTextContent("Bravo");
    // Rows: featured first; price or "Free"; rating.
    const rows = screen.getAllByRole("listitem").filter((item) => item.querySelector(".marketplace-card--row"));
    expect(rows.map((row) => row.querySelector("h3")?.textContent)).toEqual(["Bravo", "Alpha"]);
    expect(rows[1]).toHaveTextContent("Free");
    expect(rows[0]).toHaveTextContent("$49.00");
    // Proof: only the rating. Enrollments are gone (enrollment_count is not maintained).
    expect(container.querySelector('[data-section="proof"]')).toHaveTextContent("4.5(4 ratings)");
    expect(container.textContent).not.toMatch(/enrollment|student/i);
    // The footer leads to those who want to create, not to the store.
    expect(screen.getByRole("link", { name: "Made with SkillsetMind" })).toHaveAttribute("href", "/for-creators");
  });

  it("verified teacher: the badge with the words right after the name", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({
      ...ana,
      verification: { kind: "evidence", verifiedAt: "2026-09-01T12:00:00.000Z" },
    });
    await renderPage("@ana.souza");

    const heading = screen.getByRole("heading", { level: 1, name: "Ana Souza" });
    const badge = screen.getByRole("button", { name: "Verified professional" });
    expect(heading.nextElementSibling).toContainElement(badge);
    expect(badge.closest("header")).toHaveAttribute("data-section", "header");
  });

  it("without verification, no badge", async () => {
    await renderPage("@ana.souza");
    expect(screen.queryByRole("button", { name: "Verified professional" })).toBeNull();
  });

  it("no course, no main button and no proof strip", async () => {
    mocks.listCreatorCourses.mockResolvedValue([]);
    const { container } = await renderPage("@ana.souza");

    const order = [...container.querySelectorAll("[data-section]")].map((node) => node.getAttribute("data-section"));
    expect(order).toEqual(["header", "courses", "about", "footer"]);
    expect(screen.getByText("No public courses yet")).toBeInTheDocument();
  });

  it("zeroed proof does not appear", async () => {
    mocks.listCreatorCourses.mockResolvedValue([course("c-1", "Alpha")]);
    const { container } = await renderPage("@ana.souza");
    expect(container.querySelector('[data-section="proof"]')).toBeNull();
  });

  // Layout item: with `truncate`, the long title of the main button gave the
  // grid the width of the text (448px in a 343px area at 375px) and the
  // .page-shell cut off the rest. The column has to be able to shrink.
  it("the column shrinks to fit the phone, even with a long title on the button", async () => {
    mocks.listCreatorCourses.mockResolvedValue([course("c-2", "How to Lead Your First Team Without Burning Out Again")]);
    const { container } = await renderPage("@ana.souza");
    expect(container.querySelector("article")).toHaveClass("grid-cols-[minmax(0,1fr)]");
    expect(container.querySelector('[data-section="primary"]')).toHaveClass("min-w-0");
  });

  it("a short bio appears whole, without 'Read more'", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({ ...ana, bio: "Coach for first-time managers." });
    const { container } = await renderPage("@ana.souza");
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("Coach for first-time managers.")).not.toHaveClass("line-clamp-3");
  });

  it("a long bio collapsed, with a short-named button", async () => {
    const { container } = await renderPage("@ana.souza");
    const summary = container.querySelector("details > summary");
    // The accessible name is "Read more", not the whole bio.
    expect(summary?.textContent).toBe("Read more");
    expect(screen.getByText(ana.bio!)).toHaveClass("line-clamp-3");
  });

  it("a plan with a storefront: the teacher's logo, button in the brand color and theme in the header", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({
      ...ana,
      storefront: {
        ...ana.storefront,
        branding: { logoUrl: "https://cdn.example/ana-logo.png", accentColor: "#f5c518", themePreset: "warm" },
      },
    });
    const { container } = await renderPage("@ana.souza");

    // Starter also shows the logo; our brand stays in the footer.
    expect(screen.getByRole("img", { name: "Ana Souza" })).toHaveAttribute("src", "https://cdn.example/ana-logo.png");
    expect(screen.getByRole("link", { name: "Made with SkillsetMind" })).toBeInTheDocument();
    // Yellow: the button text is dark (readableTextOnAccent).
    const primary = container.querySelector<HTMLElement>('[data-section="primary"]')!;
    expect(primary).toHaveAttribute("data-accent");
    expect(primary.style.getPropertyValue("--storefront-accent")).toBe("#f5c518");
    expect(primary.style.getPropertyValue("--storefront-accent-ink")).toBe("#0a0d12");
    expect(container.querySelector('[data-section="header"]')).toHaveAttribute("data-storefront-theme", "warm");
  });

  it("nothing on the profile leads to the marketplace, not even the site menu", async () => {
    const { container } = await renderPage("@ana.souza");

    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs.filter((href) => href === "/courses" || href === "/instructors")).toEqual([]);
    expect(hrefs.every((href) => href === "/" || href === "/for-creators" || href?.startsWith("/courses/"))).toBe(true);
    expect(container.textContent).not.toMatch(/marketplace|Instructor storefront|Lessons|Categories/i);
  });

  // Store rule (#471): without a published real course, no link to /courses.
  // The profile does not link to the store even when it has a course: the visitor came from the
  // teacher's Instagram and only leaves here for a course of theirs.
  it.each([true, false])("with the store %s, no link to /courses", async (hasRealCourses) => {
    const { container } = await renderPage("@ana.souza", hasRealCourses);
    expect(container.querySelectorAll('a[href="/courses"]')).toHaveLength(0);
    expect(container.querySelectorAll('a[href^="/courses/"]').length).toBeGreaterThan(0);
  });

  it("a plan without the platform brand: no logo of ours and no 'Made with'", async () => {
    mocks.getPublicProfileByRef.mockResolvedValue({
      ...ana,
      storefront: { ...ana.storefront, branding: { hidePlatformBrand: true, logoUrl: "https://cdn.example/ana-logo.png" } },
    });
    const { container } = await renderPage("@ana.souza");
    expect(container.querySelector('a[href="/"]')).toBeNull();
    // In place of ours, the teacher's logo.
    expect(screen.getByRole("img", { name: "Ana Souza" })).toHaveAttribute("src", "https://cdn.example/ana-logo.png");
    expect(container.querySelector('[data-section="footer"]')).toBeNull();
  });

  it("courses that did not load: the profile stays online with the notice", async () => {
    mocks.listCreatorCourses.mockResolvedValue(null);
    await renderPage("@ana.souza");
    expect(screen.getByText("Instructor courses could not load right now.")).toBeInTheDocument();
  });

  it("in Spanish", async () => {
    mocks.locale = "es";
    await renderPage("@ana.souza");
    expect(screen.getByRole("link", { name: "Hecho con SkillsetMind" })).toBeInTheDocument();
  });
});
