import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { MemberAreaHomeView } from "@/components/learn/member-area-home";
import type { MemberAreaHome } from "@/lib/data/member-areas";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  // Stable like Next's: the effect depends on it.
  return { getMemberAreaHome: vi.fn(), getMemberAreaCommunity: vi.fn(), replace, router: { replace, refresh: () => undefined } };
});

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
// The real shell brings help, account and bell; here only the theme it receives matters.
vi.mock("@/components/learn/member-area-shell", () => ({
  MemberAreaShell: ({ theme = "light", children }: { theme?: string; children: ReactNode }) => (
    <div data-testid="shell" data-members-theme={theme}>{children}</div>
  ),
}));
vi.mock("@/lib/data/member-areas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/member-areas")>()),
  getMemberAreaHome: mocks.getMemberAreaHome,
  getMemberAreaCommunity: mocks.getMemberAreaCommunity,
  memberAreaCoverUrl: (path: string) => `https://media.test/${path}`,
}));

const home: MemberAreaHome = {
  area: {
    ownerId: "u-1", username: "evan", slug: null, creatorName: "Evan Stone", creatorPhotoUrl: null,
    name: "Evan Academy", theme: "dark", coverPath: "users/u-1/member-area/cover-1",
    welcomeText: "Welcome to the academy.", configured: true, isOwnerPreview: false,
  },
  continueWatching: {
    courseId: "c-a", courseTitle: "Emotional Intelligence Mastery", lessonId: "l-2",
    lessonTitle: "Naming emotions", positionSeconds: 95, lastSeenAt: null,
  },
  myProducts: [{
    courseId: "c-a", title: "Emotional Intelligence Mastery", coverImageUrl: null, productFormat: "course",
    lessonCount: 17, progressPercent: 12, enrollmentStatus: "active",
  }],
  moreProducts: [{
    courseId: "c-b", title: "Leadership Blind Spots", coverImageUrl: null, priceAmountMinor: 9700,
    currency: "usd", paymentType: "one_time", salesKey: "leadership-blind-spots",
  }],
};

function renderView(ref = "@evan", locale: "en" | "es" = "en") {
  return render(
    <I18nProvider initialLocale={locale}>
      <MemberAreaHomeView areaRef={ref} />
    </I18nProvider>,
  );
}

describe("MemberAreaHomeView", () => {
  beforeEach(() => {
    mocks.getMemberAreaHome.mockReset();
    mocks.getMemberAreaCommunity.mockReset().mockResolvedValue(null);
    mocks.replace.mockReset();
    window.localStorage.clear();
  });

  // Before, the shell was born light during the read and a dark area turned
  // dark a moment later. The theme only arrives with the read: on the first
  // visit the wait is neutral (no theme), on a return it already comes out in the stored theme.
  it("loading: a neutral frame on the first visit, the stored theme on a return", async () => {
    mocks.getMemberAreaHome.mockResolvedValue(home);
    const first = renderView();
    expect(screen.getByTestId("shell")).not.toHaveAttribute("data-members-theme");
    expect(screen.getByRole("status")).toHaveTextContent("Loading the members area...");
    expect(await screen.findByRole("heading", { level: 1, name: "Evan Academy" })).toBeTruthy();
    expect(screen.getByTestId("shell").getAttribute("data-members-theme")).toBe("dark");
    first.unmount();

    renderView();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByTestId("shell").getAttribute("data-members-theme")).toBe("dark");
    expect(await screen.findByRole("heading", { level: 1, name: "Evan Academy" })).toBeTruthy();
  });

  // Community of the whole area: a card at the top when the teacher chose one;
  // if its read fails, the area opens the same, without the card.
  it("shows the area's community card and the type of each product", async () => {
    mocks.getMemberAreaHome.mockResolvedValue(home);
    mocks.getMemberAreaCommunity.mockResolvedValue({ courseId: "c-club", title: "Inner circle", isOwner: false });
    renderView();
    const card = await screen.findByRole("link", { name: /^Community/ });
    expect(card.getAttribute("href")).toBe("/learn/areas/%40evan/community");
    expect(card.textContent).toContain("Talk with everyone learning with Evan Stone.");
    expect(within(screen.getByRole("region", { name: "My products" })).getByRole("link").textContent).toContain("Course");
    // "Open the community" is 14px text: it asks for the course's readable highlight,
    // not the button background (2.9:1 on a dark course).
    const open = within(card).getByText("Open the community");
    expect(open).toHaveClass("text-[var(--ma-accent-ink)]");
    expect(open).not.toHaveClass("text-[var(--ma-accent)]");
  });

  it("opens the area even if the community fails", async () => {
    mocks.getMemberAreaHome.mockResolvedValue(home);
    mocks.getMemberAreaCommunity.mockRejectedValue(new Error("boom"));
    renderView();
    expect(await screen.findByRole("heading", { name: "Evan Academy" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Community/ })).toBeNull();
  });
  afterEach(cleanup);

  it("shows the area in its own theme, with the three sections", async () => {
    mocks.getMemberAreaHome.mockResolvedValue(home);
    renderView();
    expect(await screen.findByRole("heading", { level: 1, name: "Evan Academy" })).toBeTruthy();
    expect(mocks.getMemberAreaHome).toHaveBeenCalledWith("@evan", null);
    expect(screen.getByTestId("shell").getAttribute("data-members-theme")).toBe("dark");
    expect(screen.getByText("By Evan Stone")).toBeTruthy();
    expect(screen.getByText("Welcome to the academy.")).toBeTruthy();

    const resume = screen.getByRole("link", { name: /Resume: Naming emotions/ });
    expect(resume.getAttribute("href")).toBe("/learn/courses/c-a?lesson=l-2");
    expect(resume.textContent).toContain("from 1:35");

    const mine = screen.getByRole("region", { name: "My products" });
    expect(within(mine).getByRole("link").getAttribute("href")).toBe("/learn/courses/c-a");
    expect(within(mine).getByText("12% complete")).toBeTruthy();
    // The house bar, announced as a bar (before it was just a mute stroke).
    expect(within(mine).getByRole("progressbar", { name: "12% complete" }).getAttribute("aria-valuenow")).toBe("12");

    const more = screen.getByRole("region", { name: "More from this creator" });
    expect(within(more).getByText("Locked")).toBeTruthy();
    expect(within(more).getByText("$97.00")).toBeTruthy();
    expect(within(more).getByRole("link", { name: "See details" }).getAttribute("href"))
      .toBe("/courses/leadership-blind-spots");
    // A product that was not purchased never leads to the room: every storefront link is a sales page.
    for (const link of within(more).getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/courses\//);
    }
  });

  it("whoever is neither a learner nor the owner goes to the public storefront", async () => {
    mocks.getMemberAreaHome.mockResolvedValue(null);
    renderView("@evan");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/@evan"));
    cleanup();
    renderView("u-1");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/instructors/u-1"));
  });

  it("empty states and the owner's preview", async () => {
    mocks.getMemberAreaHome.mockResolvedValue({
      ...home,
      area: { ...home.area, isOwnerPreview: true, coverPath: null, welcomeText: null },
      continueWatching: null,
      myProducts: [],
      moreProducts: [],
    });
    renderView();
    expect(await screen.findByText(/Preview: this is what your students see/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit members area" }).getAttribute("href")).toBe("/teach/member-area");
    // An empty section goes away (a title + "nothing here" were a section with no content);
    // only "My products" stays, with the empty notice.
    expect(screen.queryByRole("region", { name: "Continue where you left off" })).toBeNull();
    expect(screen.queryByText("Open one of your products below to start.")).toBeNull();
    expect(screen.getByText("You have no products from this creator yet.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "More from this creator" })).toBeNull();
    expect(screen.queryByText("This creator has no other products yet.")).toBeNull();
    expect(screen.queryByText("You already have every product from this creator.")).toBeNull();
  });

  it("whoever already has everything does not see the empty storefront; a subscription shows the interval", async () => {
    mocks.getMemberAreaHome.mockResolvedValueOnce({ ...home, moreProducts: [] });
    renderView();
    expect(await screen.findByRole("region", { name: "My products" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "More from this creator" })).toBeNull();
    expect(screen.queryByText("You already have every product from this creator.")).toBeNull();
    cleanup();
    mocks.getMemberAreaHome.mockResolvedValueOnce({
      ...home,
      moreProducts: [
        { ...home.moreProducts[0], paymentType: "subscription_monthly", priceAmountMinor: 1900 },
        { ...home.moreProducts[0], courseId: "c-y", paymentType: "subscription_yearly", priceAmountMinor: 19000 },
      ],
    });
    renderView();
    expect(await screen.findByText("$19.00 / month")).toBeTruthy();
    expect(screen.getByText("$190.00 / year")).toBeTruthy();
  });

  it("a read error asks for another try", async () => {
    mocks.getMemberAreaHome.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(home);
    renderView();
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("heading", { level: 1, name: "Evan Academy" })).toBeTruthy();
  });

  it("in Spanish", async () => {
    mocks.getMemberAreaHome.mockResolvedValue(home);
    renderView("@evan", "es");
    expect(await screen.findByRole("region", { name: "Más de este creador" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver detalles" })).toBeTruthy();
  });
});
