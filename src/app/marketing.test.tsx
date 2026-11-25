import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from "@/app/page";
import { RealCoursesProvider } from "@/components/site/real-courses";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

// Storefront open (12 real courses from 5 teachers)? That is the contract of
// isMarketplaceOpen. It starts closed: that is today's state. The title and
// cover of the "See a real course" card come from getShowcaseCourseCover (null
// = the read failed or timed out; the timeout itself is tested in
// public-course.test).
type ShowcaseCover = { title: string; coverImageUrl: string | null };
const state = vi.hoisted(() => ({ open: false, course: null as ShowcaseCover | null }));
const readCourse = vi.hoisted(() =>
  vi.fn<(id: string) => Promise<ShowcaseCover | null>>(async () => state.course),
);
vi.mock("@/lib/data/server/public-course", () => ({
  isMarketplaceOpen: async () => state.open,
  getShowcaseCourseCover: readCourse,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

// The footer and the five marketing sections are async server components: they
// resolve the language via next/headers and do not render in this synchronous
// jsdom test. Their content is checked in site-frame.test.tsx, mounting each
// section directly with `render(await Section())`. What is left here is what
// this file has always really looked at: the header, which is still a client
// component.
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/site/marketing-hero", () => ({ MarketingHero: () => null }));
vi.mock("@/components/site/how-it-works-strip", () => ({ HowItWorksStrip: () => null }));
vi.mock("@/components/site/capabilities-grid", () => ({ CapabilitiesGrid: () => null }));
vi.mock("@/components/site/promise-preview-band", () => ({ PromisePreviewBand: () => null }));
vi.mock("@/components/site/for-creators-band", () => ({ ForCreatorsBand: () => null }));
// The facts band is also a server component; its content is checked in
// home-facts-band.test.tsx. Here it only marks the spot, for the order.
vi.mock("@/components/site/home-facts-band", () => ({ HomeFactsBand: () => <div data-testid="facts-band" /> }));
// Same for the FAQ (home-faq.test.tsx); its spot is #faq.
vi.mock("@/components/site/home-faq", () => ({ HomeFaq: () => null }));
// Same for the "who it is for" band (home-who-for.test.tsx): no anchor, it marks the spot.
vi.mock("@/components/site/home-who-for", () => ({ HomeWhoFor: () => <div data-testid="who-for" /> }));
vi.mock("@/components/site/featured-courses", () => ({ FeaturedCourses: () => <div data-testid="marketplace" /> }));

beforeEach(() => {
  state.open = false;
  state.course = null;
  readCourse.mockClear();
});

const COVER = "https://example.supabase.co/storage/v1/object/public/covers/ei-mastery.jpg";
const showcase: ShowcaseCover = { title: "Emotional Intelligence Mastery", coverImageUrl: COVER };
afterEach(cleanup);

// The root layout passes the same answer to the header through the provider.
async function renderHome() {
  return render(<RealCoursesProvider value={state.open}>{await Home()}</RealCoursesProvider>);
}

const headerLinks = () =>
  within(screen.getByRole("navigation", { name: "Primary navigation" }))
    .getAllByRole("link")
    .map((link) => [link.textContent?.trim(), link.getAttribute("href")]);

describe("marketing home", () => {
  // The home menu is the same as on the other pages: links, no anchor, and Help.
  it("uses the same header as every other page while the marketplace is closed", async () => {
    await renderHome();

    expect(headerLinks()).toEqual([
      ["For creators", "/for-creators"],
      ["Pricing", "/pricing"],
      ["Promise", "/promise"],
      ["Help", "/help"],
    ]);
  });

  // Storefront closed: no "The marketplace" band; in its place, a card that
  // leads to a real course (the owner's).
  it("swaps the marketplace band for one real course while fewer than 12 courses from 5 teachers are live", async () => {
    const { container } = await renderHome();

    expect(container.querySelector("#courses")).toBeNull();
    expect(screen.queryByTestId("marketplace")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See a real course on SkillsetMind/ })).toHaveAttribute(
      "href",
      "/courses/1a280dc6-acce-4f1f-9e95-56df095131ae",
    );
  });

  it("opens the marketplace band and the Courses link by itself once the threshold is met", async () => {
    state.open = true;
    const { container } = await renderHome();

    expect(container.querySelector("#courses")).not.toBeNull();
    expect(screen.getByTestId("marketplace")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /See a real course/ })).not.toBeInTheDocument();
    expect(headerLinks()[0]).toEqual(["Courses", "/courses"]);
    // Storefront open: the real course card does not exist, the read does not happen.
    expect(readCourse).not.toHaveBeenCalled();
  });

  // The course's real cover inside the same link, with the course title as
  // alt text (it is not a new phrase in the dictionary).
  it("shows the real course cover inside the card link, with the course title as alt", async () => {
    state.course = showcase;
    await renderHome();

    expect(readCourse).toHaveBeenCalledWith("1a280dc6-acce-4f1f-9e95-56df095131ae");
    const card = screen.getByRole("link", { name: /See a real course on SkillsetMind/ });
    expect(card).toHaveAttribute("href", "/courses/1a280dc6-acce-4f1f-9e95-56df095131ae");
    const cover = within(card).getByRole("img", { name: "Emotional Intelligence Mastery" });
    expect(cover).toHaveAttribute("src", expect.stringContaining(encodeURIComponent(COVER)));
    // Below the fold: lazy-loaded, with no priority over the top.
    expect(cover).toHaveAttribute("loading", "lazy");
    expect(within(card).getByText("Open the course")).toBeInTheDocument();
  });

  // No cover, or a read that failed or timed out (null): the text-only card
  // from before, with no empty image frame.
  it.each([
    ["the course has no cover", { ...showcase, coverImageUrl: null }],
    ["the read fails or times out", null],
  ])("keeps the text-only card when %s", async (_case, course) => {
    state.course = course;
    await renderHome();

    const card = screen.getByRole("link", { name: /See a real course on SkillsetMind/ });
    expect(card).toHaveAttribute("href", "/courses/1a280dc6-acce-4f1f-9e95-56df095131ae");
    expect(within(card).queryByRole("img")).not.toBeInTheDocument();
    expect(card.querySelector(".aspect-\\[16\\/9\\]")).toBeNull();
    for (const text of [
      "A real course",
      "See a real course on SkillsetMind",
      "Open a published course the way a buyer sees it: the sales page, the lessons and the preview lesson.",
      "Open the course",
    ]) {
      expect(within(card).getByText(text)).toBeInTheDocument();
    }
  });

  // The order of the blocks inside <main> (the top is mocked and does not
  // appear): the facts band comes right after the top and before "How it
  // works"; the FAQ, between the Promise and the final band; the "who it is
  // for" band, between the features and the Promise.
  it("keeps the home blocks in order: facts band after the hero, who-for before the Promise, FAQ after it", async () => {
    const { container } = await renderHome();

    const blocks = [...container.querySelector("main")!.children].map(
      (block) => block.id || block.getAttribute("data-testid"),
    );
    expect(blocks).toEqual(["facts-band", "how-it-works", "real-course", "capabilities", "who-for", "promise", "faq", "for-creators"]);
    // The anchor lands below the fixed bar, like the other sections.
    expect(container.querySelector("#faq")).toHaveClass("scroll-mt-28");
  });

  // Basic accessibility: one <main> landmark per page, the target of the "Skip
  // to content" that opens the bar.
  it("has exactly one <main id=\"conteudo\">, the target of skip to content", async () => {
    const { container } = await renderHome();

    const mains = container.querySelectorAll("main");
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute("id", "conteudo");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#conteudo");
  });
});
