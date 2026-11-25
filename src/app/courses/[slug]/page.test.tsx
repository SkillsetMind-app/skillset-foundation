import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import CourseDetailPage, { generateMetadata } from "@/app/courses/[slug]/page";
import type { CourseRefAccess, PublicCourseSummary } from "@/lib/data/server/public-course";

const mocks = vi.hoisted(() => ({
  getPublicCourseByRef: vi.fn<() => Promise<PublicCourseSummary | null>>(),
  getCourseRefAccess: vi.fn<() => Promise<CourseRefAccess>>(),
  isMarketplaceOpen: vi.fn(async () => true),
  // Como o Next: notFound() interrompe a renderizacao lancando.
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  // true: the client component "suspends", and the Suspense shows the fallback.
  suspendClient: false,
  pending: new Promise(() => {}),
}));

vi.mock("@/lib/data/server/public-course", () => ({
  getPublicCourseByRef: mocks.getPublicCourseByRef,
  getCourseRefAccess: mocks.getCourseRefAccess,
  isMarketplaceOpen: mocks.isMarketplaceOpen,
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks does not undo the mockResolvedValue of the previous test: without these
  // defaults, a published course from another test answered for the sample's slug.
  mocks.getPublicCourseByRef.mockResolvedValue(null);
  mocks.getCourseRefAccess.mockResolvedValue("missing");
});

// The real client component opens a subscription on Supabase; here only the
// contract matters: the page signals when the header already came out of the server and
// hands over the header (`lead`) for the top of the left column.
vi.mock("@/components/courses/creator-course-detail", () => ({
  CreatorCourseDetail: ({ hideHeader, lead }: { hideHeader?: boolean; lead?: ReactNode }) => {
    if (mocks.suspendClient) throw mocks.pending;
    return (
      <div data-testid="client-detail">
        {lead}
        {hideHeader ? "client header hidden" : "client header shown"}
      </div>
    );
  },
}));

vi.mock("@/components/site/site-nav", () => ({
  SiteNav: () => null,
}));

// Async server component with its own test; here all that matters is that it is on the page.
vi.mock("@/components/site/site-footer", () => ({
  SiteFooter: () => <footer data-testid="site-footer" />,
}));

// The sample's enroll button reads the session; here only the return matters.
vi.mock("@/components/courses/course-enrollment-cta", () => ({
  CourseEnrollmentCta: () => null,
}));

afterEach(cleanup);

const COVER = "https://example.supabase.co/storage/v1/object/public/covers/deep-focus.jpg";

const published: PublicCourseSummary = {
  id: "course-1",
  urlSlug: "deep-focus-systems",
  title: "Deep Focus Systems",
  summary: "Build a repeatable focus practice.",
  category: "Performance",
  coverImageUrl: COVER,
  lessonCount: 12,
  productFormat: "course",
  updatedAt: null,
};

// Slug that does NOT exist in the static catalog: falls into the creator course branch.
async function renderPage(slug = "deep-focus-systems") {
  render(await CourseDetailPage({ params: Promise.resolve({ slug }) }));
}

describe("creator course page", () => {
  it("renders title, cover and summary once, on the server, and silences the client header", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(published);

    await renderPage();

    // Before: the server put the title and the client drew a navy card
    // with the SAME title and summary right below.
    const title = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });
    expect(title).toHaveClass("page-title");
    expect(title.className).not.toMatch(/text-(4|5|6)xl/);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("client header hidden")).toBeInTheDocument();
    // The header goes inside the client page (top of the left
    // column, next to the purchase card), and no longer alone above it.
    expect(screen.getByTestId("client-detail")).toContainElement(title);
    expect(screen.getByText("12 lecciones")).toBeInTheDocument();

    // The cover that the marketplace card already showed.
    expect(screen.getByRole("img", { name: "Deep Focus Systems" })).toHaveAttribute(
      "src",
      expect.stringContaining(encodeURIComponent(COVER)),
    );
    // A published course renders without the extra query and without a 404.
    expect(mocks.getCourseRefAccess).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
    // Terms and refund policy within reach of whoever is about to pay.
    expect(screen.getByTestId("site-footer")).toBeInTheDocument();
  });

  // If the client part does not resolve on the server, the HTML carries the fallback: it
  // also brings the header, so title, cover and summary never disappear from the HTML.
  it("until the client arrives, the skeleton already carries the h1, the cover and the summary", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(published);
    mocks.suspendClient = true;
    try {
      await renderPage();

      expect(screen.getByRole("status")).toHaveTextContent("Cargando curso...");
      expect(screen.getAllByRole("heading", { level: 1, name: "Deep Focus Systems" })).toHaveLength(1);
      expect(screen.getByText("Build a repeatable focus practice.")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Deep Focus Systems" })).toBeInTheDocument();
      expect(screen.queryByTestId("client-detail")).not.toBeInTheDocument();
    } finally {
      mocks.suspendClient = false;
    }
  });

  // A link to an unpublished or removed course or an invalid slug answered 200 with
  // an empty page: bad for ads and for the search engine.
  it("a course that does not exist for whoever asks answers 404 before drawing the page", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(null);
    mocks.getCourseRefAccess.mockResolvedValue("missing");

    await expect(renderPage("does-not-exist")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getCourseRefAccess).toHaveBeenCalledWith("does-not-exist");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("a draft visible to the owner keeps the client page, which draws its own header", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(null);
    mocks.getCourseRefAccess.mockResolvedValue("visible");

    await renderPage("draft");

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText("client header shown")).toBeInTheDocument();
  });

  it("a read failure does not become a 404", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(null);
    mocks.getCourseRefAccess.mockResolvedValue("unknown");

    await renderPage("talvez-exista");

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.getByText("client header shown")).toBeInTheDocument();
  });

  it("without a summary, the <meta> description uses the title — and a title with $& appears literally", async () => {
    // In a replace without a callback, "$&" becomes the matched piece ("{title}"). The title is
    // the teacher's text, not ours.
    mocks.getPublicCourseByRef.mockResolvedValue({ ...published, title: "Deep $& Focus", summary: null });

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "deep-focus-systems" }) });

    expect(metadata.description).toContain("Deep $& Focus: contenido");
  });
});

// Sample from the demo catalog: the back link only leads to the store when it has a
// real course; empty, it leads to the start.
describe("back link of the sample page", () => {
  it.each([
    [true, "Volver a todos los cursos", "/courses"],
    [false, "Ir al inicio", "/"],
  ])("store with a real course: %s", async (value, name, href) => {
    mocks.isMarketplaceOpen.mockResolvedValue(value);
    render(await CourseDetailPage({ params: Promise.resolve({ slug: "leadership-development" }) }));

    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    expect(screen.getByTestId("site-footer")).toBeInTheDocument();
  });
});

// The sample fell behind the real course: the price came labeled "Access"
// in 10px, on the card and on the phone bar. Now "Price" in 12px, on both.
describe("price label of the sample page", () => {
  const es = (key: string) => translate(getDictionary("es"), key);

  it("says Price on the card and on the bar, and no longer Access", async () => {
    const { container } = render(await CourseDetailPage({ params: Promise.resolve({ slug: "leadership-development" }) }));

    const eyebrows = screen.getAllByText(es("publicCourses.priceEyebrow"));
    expect(eyebrows).toHaveLength(2);
    expect(container.querySelector("#enroll-card")).toContainElement(eyebrows[0]);
    expect(container.querySelector("#enroll-card")).not.toContainElement(eyebrows[1]);
    for (const eyebrow of eyebrows) {
      expect(eyebrow).toHaveClass("text-xs", "uppercase");
      expect(eyebrow).not.toHaveClass("text-[10px]");
    }
    expect(screen.queryByText("Acceso")).toBeNull();
  });
});

// The sample had 32px uppercase rows with hyphens ("PREVIEW - VIDEO -
// 8 MIN") and everything open: now the same curriculum as the page of a real course.
describe("curriculum of the sample page", () => {
  const es = (key: string) => translate(getDictionary("es"), key);

  it("one module per accordion, the first one open, lessons and duration on the module row", async () => {
    const { container } = render(await CourseDetailPage({ params: Promise.resolve({ slug: "leadership-development" }) }));

    const toggles = Array.from(container.querySelectorAll<HTMLButtonElement>("#curriculum h3 > button[aria-expanded]"));
    expect(toggles).toHaveLength(2);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(toggles[1]).toHaveAttribute("aria-expanded", "false");
    expect(within(toggles[0]).getByText(`${es("publicCourses.lessonMany").replace("{count}", "2")} · 20 min`)).toBeInTheDocument();

    const panel = document.getElementById(toggles[0].getAttribute("aria-controls")!) as HTMLElement;
    const meta = within(panel).getByText(`${es("publicCourses.lessonTypes.video")} · 8 min · ${es("publicCourses.previewShort")}`);
    expect(meta).not.toHaveClass("uppercase");
    expect(meta.parentElement).toHaveClass("min-h-11");
  });
});

describe("course page indexing", () => {
  const metadataFor = (slug: string) => generateMetadata({ params: Promise.resolve({ slug }) });

  it("a real published course is indexable", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(published);
    expect((await metadataFor("deep-focus-systems")).robots).toMatchObject({ index: true });
  });

  // Sample from the demo catalog: nobody buys it, but the page shows
  // price and "Inscrever-se". It stays online (the owner's decision), outside the index.
  it("a sample from the demo catalog is not indexed", async () => {
    expect((await metadataFor("leadership-development")).robots).toMatchObject({ index: false });
  });

  // Internal test course: it still opens by direct link, as the store
  // already did, but it cannot stay in the index after leaving the sitemap.
  it("an internal test course is not indexed", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue({ ...published, title: "[QA] Internal test course" });
    expect((await metadataFor("qa-internal-test-course")).robots).toMatchObject({ index: false });
  });
});

// The address of a real course is the title turned into a slug: a teacher who calls the
// course "Effective Communication" gets /courses/effective-communication, the
// same address as one of the samples. The real course has to win.
describe("real course at a sample's address", () => {
  const SAMPLE_SLUG = "effective-communication";
  const SAMPLE_SUMMARY = "A practical communication pathway for professionals who want stronger confidence and clearer influence.";
  const real: PublicCourseSummary = {
    ...published,
    id: "course-real-1",
    urlSlug: SAMPLE_SLUG,
    title: "Effective Communication",
    summary: "The teacher's own course on difficult conversations.",
  };
  const renderAt = async () => render(await CourseDetailPage({ params: Promise.resolve({ slug: SAMPLE_SLUG }) }));
  const metadataAt = () => generateMetadata({ params: Promise.resolve({ slug: SAMPLE_SLUG }) });

  it("published course: the page and the metadata are the course's, not the sample's", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(real);

    const { container } = await renderAt();

    const title = screen.getByRole("heading", { level: 1, name: "Effective Communication" });
    expect(screen.getByTestId("client-detail")).toContainElement(title);
    expect(screen.getByText("The teacher's own course on difficult conversations.")).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_SUMMARY)).toBeNull();
    // Nothing from the sample: neither its price card nor the static curriculum.
    expect(container.querySelector("#enroll-card")).toBeNull();
    expect(container.querySelector("#curriculum")).toBeNull();
    expect(mocks.getPublicCourseByRef).toHaveBeenCalledWith(SAMPLE_SLUG);
    expect(mocks.getCourseRefAccess).not.toHaveBeenCalled();

    const metadata = await metadataAt();
    expect(metadata.description).toBe("The teacher's own course on difficult conversations.");
    expect(metadata.robots).toMatchObject({ index: true });
    expect(metadata.alternates?.canonical).toContain(`/courses/${SAMPLE_SLUG}`);
  });

  it("no real course: the usual sample, outside the index", async () => {
    const { container } = await renderAt();

    expect(screen.getByRole("heading", { level: 1, name: "Effective Communication" })).not.toHaveClass("page-title");
    expect(screen.getByText(SAMPLE_SUMMARY)).toBeInTheDocument();
    expect(container.querySelector("#enroll-card")).not.toBeNull();
    expect(screen.queryByTestId("client-detail")).toBeNull();
    expect(mocks.getCourseRefAccess).toHaveBeenCalledWith(SAMPLE_SLUG);
    expect(mocks.notFound).not.toHaveBeenCalled();

    const metadata = await metadataAt();
    expect(metadata.description).toBe(SAMPLE_SUMMARY);
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it("owner's draft at this address: the owner sees the draft, as at any other address", async () => {
    mocks.getCourseRefAccess.mockResolvedValue("visible");

    await renderAt();

    expect(screen.getByText("client header shown")).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_SUMMARY)).toBeNull();
    expect(mocks.notFound).not.toHaveBeenCalled();

    const metadata = await metadataAt();
    expect(metadata.description).not.toBe(SAMPLE_SUMMARY);
  });

  it("read failure: the sample stays online, without a 404", async () => {
    mocks.getCourseRefAccess.mockResolvedValue("unknown");

    await renderAt();

    expect(screen.getByText(SAMPLE_SUMMARY)).toBeInTheDocument();
    expect(screen.queryByTestId("client-detail")).toBeNull();
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect((await metadataAt()).robots).toMatchObject({ index: false });
  });

  it("an address that is neither a sample nor a course is still 404, and the metadata does not query access", async () => {
    await expect(renderPage("neither-sample-nor-course")).rejects.toThrow("NEXT_NOT_FOUND");

    mocks.getCourseRefAccess.mockClear();
    await generateMetadata({ params: Promise.resolve({ slug: "neither-sample-nor-course" }) });
    expect(mocks.getCourseRefAccess).not.toHaveBeenCalled();
  });
});

vi.mock("@/lib/i18n/server", () => ({ getServerTranslation: async () => ({ locale: "es", t: (key: string) => translate(getDictionary("es"), key) }) }));
