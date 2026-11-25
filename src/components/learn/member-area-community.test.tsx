import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { MemberAreaCommunityView } from "@/components/learn/member-area-community";
import { rememberMemberAreaTheme } from "@/lib/data/member-areas";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return { getMemberAreaCommunity: vi.fn(), router: { replace, refresh: () => undefined } };
});

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/components/learn/member-area-shell", () => ({
  MemberAreaShell: ({ theme = "light", children }: { theme?: string | null; children: ReactNode }) => (
    <div data-testid="shell" data-members-theme={theme ?? undefined}>{children}</div>
  ),
}));
// The feed has its own tests; here only the surface around it matters.
vi.mock("@/components/learn/community-feed", () => ({
  CommunityFeed: () => <p>feed</p>,
}));
vi.mock("@/lib/data/member-areas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/member-areas")>()),
  getMemberAreaCommunity: mocks.getMemberAreaCommunity,
}));

function renderView() {
  return render(
    <I18nProvider initialLocale="en">
      <MemberAreaCommunityView areaRef="@eton" />
    </I18nProvider>,
  );
}

// Before, the area's community never received the theme: the same area was dark on the
// cover and light here, and the feed stayed in the platform's tones.
describe("MemberAreaCommunityView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.getMemberAreaCommunity.mockReset().mockResolvedValue({ courseId: "c-1", title: "Eton Circle", isOwner: false });
  });

  it("opens in the theme the area showed, with the feed on the classroom's themed surface", async () => {
    rememberMemberAreaTheme("@eton", null, "dark");
    renderView();
    // Already loading, in the right theme.
    expect(screen.getByRole("status")).toHaveTextContent("Loading the members area...");
    expect(screen.getByTestId("shell").getAttribute("data-members-theme")).toBe("dark");

    expect(await screen.findByRole("heading", { level: 1, name: "Eton Circle" })).toBeTruthy();
    expect(screen.getByTestId("shell").getAttribute("data-members-theme")).toBe("dark");
    const surface = screen.getByText("feed").closest(".member-classroom");
    expect(surface).toHaveAttribute("data-members-theme", "dark");
  });

  // The error used to be a dead end (just the sentence): "Try again" calls the same read, locks
  // while it runs, and the notice only goes away when the community arrives.
  it("the failure offers Try again, which reads again and opens the community with focus on the frame", async () => {
    mocks.getMemberAreaCommunity.mockRejectedValueOnce(new Error("offline"));
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load this members area. Please try again.");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const busy = screen.getByRole("button", { name: "Trying again..." });
    expect(busy).toBeDisabled();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { level: 1, name: "Eton Circle" })).toBeTruthy();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.getMemberAreaCommunity).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }).parentElement);
  });

  it("two clicks before redrawing start a single reread", async () => {
    mocks.getMemberAreaCommunity.mockRejectedValueOnce(new Error("offline"));
    renderView();
    const button = await screen.findByRole("button", { name: "Try again" });
    act(() => {
      button.click();
      button.click();
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Eton Circle" })).toBeTruthy();
    expect(mocks.getMemberAreaCommunity).toHaveBeenCalledTimes(2);
  });

  // With the globals.css link rule carrying no color outside a layer, the requested color
  // reaches the screen: --ma-accent (button background) gave 2.9:1 on a dark course.
  it("the back link asks for the course's accent text color, not the button background", async () => {
    renderView();
    const back = await screen.findByRole("link", { name: /Back to the area/ });
    expect(back).toHaveClass("text-[var(--ma-accent-ink)]");
    expect(back).not.toHaveClass("text-[var(--ma-accent)]");
  });

  it("with no saved theme: neutral wait and opens in the default light theme", async () => {
    renderView();
    expect(screen.getByTestId("shell")).not.toHaveAttribute("data-members-theme");
    expect(await screen.findByRole("heading", { level: 1, name: "Eton Circle" })).toBeTruthy();
    expect(screen.getByTestId("shell").getAttribute("data-members-theme")).toBe("light");
    expect(screen.getByText("feed").closest(".member-classroom")).toHaveAttribute("data-members-theme", "light");
  });
});
