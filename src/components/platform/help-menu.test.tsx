import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getHelpChoices, HelpMenu } from "@/components/platform/help-menu";
import { MobileSidebarDrawer } from "@/components/platform/mobile-sidebar-drawer";
import { PlatformNav } from "@/components/platform/platform-nav";
import { AdvisorSidebar } from "@/components/teacher/advisor-sidebar";

// The Help button: the same everywhere, three choices per side.

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "teacher-1", email: "t@example.com", displayName: "T", emailVerified: true, photoURL: null, roles: ["teacher"] },
  }),
}));
vi.mock("@/lib/advisor/config", () => ({ isAdvisorEnabled: true }));
vi.mock("@/lib/data/creator-verification", () => ({ fetchCreatorActivationBlocked: vi.fn().mockResolvedValue(false) }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ conversationId: null, messages: [] }) }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("as escolhas por lado", () => {
  it("learner outside a course: communities, messages and the help center before a person", () => {
    expect(getHelpChoices("student", null, false)).toEqual([
      expect.objectContaining({ id: "lesson", href: "/learn/community" }),
      expect.objectContaining({ id: "private", href: "/learn/messages" }),
      expect.objectContaining({ id: "account", href: "/help", personHref: "/support" }),
    ]);
  });

  it("learner inside a course: the question goes to its community, or to the teacher if it is turned off", () => {
    const course = { href: "/learn/courses/c-1", communityEnabled: true };
    expect(getHelpChoices("student", course, false)[0]).toMatchObject({
      href: "/learn/courses/c-1/community",
      hintKey: "helpMenu.student.lessonCommunity",
    });
    expect(getHelpChoices("student", { ...course, communityEnabled: false }, false)[0]).toMatchObject({
      href: "/learn/courses/c-1/messages",
      hintKey: "helpMenu.student.lessonMessage",
    });
    expect(getHelpChoices("student", course, false)[1].href).toBe("/learn/courses/c-1/messages");
  });

  it("teacher: Advisor (or the help center, without Advisor), Inbox and support", () => {
    expect(getHelpChoices("teacher", null, true)).toEqual([
      expect.objectContaining({ id: "howTo", opensAdvisor: true }),
      expect.objectContaining({ id: "students", href: "/teach/messages" }),
      expect.objectContaining({ id: "account", href: "/support" }),
    ]);
    const withoutAdvisor = getHelpChoices("teacher", null, false)[0];
    expect(withoutAdvisor.href).toBe("/help");
    expect(withoutAdvisor.opensAdvisor).toBeFalsy();
  });
});

describe("keyboard and screen reader", () => {
  it("opens a dialog with a title, focuses the first choice and closes on Escape returning focus", () => {
    render(<HelpMenu variant="bar" side="student" />);

    const trigger = screen.getByRole("button", { name: "Help" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "What do you need help with?" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    const first = within(dialog).getByRole("link", { name: /Question about a lesson/ });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("the top one closes on an outside click; choosing closes it and tells whoever opened it", () => {
    const onNavigate = vi.fn();
    render(<HelpMenu variant="bar" side="student" onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("link", { name: "Talk to a person" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("arrows move between the choices, wrapping around; from the button, the arrow leads inside", () => {
    render(<HelpMenu variant="bar" side="student" />);
    const trigger = screen.getByRole("button", { name: "Help" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    const lesson = within(dialog).getByRole("link", { name: /Question about a lesson/ });
    const privateMatter = within(dialog).getByRole("link", { name: /Private matter with the teacher/ });
    const person = within(dialog).getByRole("link", { name: "Talk to a person" });
    expect(lesson).toHaveFocus();

    fireEvent.keyDown(lesson, { key: "ArrowDown" });
    expect(privateMatter).toHaveFocus();
    fireEvent.keyDown(privateMatter, { key: "ArrowUp" });
    expect(lesson).toHaveFocus();
    fireEvent.keyDown(lesson, { key: "ArrowUp" });
    expect(person).toHaveFocus();
    fireEvent.keyDown(person, { key: "ArrowDown" });
    expect(lesson).toHaveFocus();

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(lesson).toHaveFocus();
  });

  it("leaving the top panel with Tab closes it; focus goes to wherever the person went", () => {
    render(
      <>
        <HelpMenu variant="bar" side="student" />
        <a href="/next">Next thing</a>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const person = screen.getByRole("link", { name: "Talk to a person" });
    const next = screen.getByRole("link", { name: "Next thing" });

    // Inside the panel, it does not close.
    fireEvent.blur(person, { relatedTarget: screen.getByRole("link", { name: /Question about a lesson/ }) });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.blur(person, { relatedTarget: next });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Help" })).toHaveAttribute("aria-expanded", "false");
  });

  // On the tablet the sidebar is an icon rail: Help opens the drawer already on Help.
  // The drawer takes focus on opening; focus has to end up INSIDE the choices.
  it("opened from the collapsed rail, in the drawer, focus goes to the first choice", async () => {
    render(<MobileSidebarDrawer open initialSection="help" onOpen={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "What do you need help with?" });
    const first = within(dialog).getAllByRole("link")[0];
    await waitFor(() => expect(first).toHaveFocus());
  });

  it("in the collapsed sidebar that opens on click, focus goes to the first choice", () => {
    function Sidebar() {
      const [collapsed, setCollapsed] = useState(true);
      return <PlatformNav collapsed={collapsed} onRequestExpand={() => setCollapsed(false)} />;
    }
    render(<Sidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));

    const dialog = screen.getByRole("dialog", { name: "What do you need help with?" });
    expect(within(dialog).getAllByRole("link")[0]).toHaveFocus();
  });

  it("the learner sees 'talk to a person' after the assistant", () => {
    render(<HelpMenu variant="bar" side="student" />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));

    const dialog = screen.getByRole("dialog");
    const assistant = within(dialog).getByRole("link", { name: /Login, payment, refund or something broken/ });
    const person = within(dialog).getByRole("link", { name: "Talk to a person" });
    expect(assistant).toHaveAttribute("href", "/help");
    expect(person).toHaveAttribute("href", "/support");
    expect(assistant.compareDocumentPosition(person)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("inside the studio, 'How do I do X' opens the Advisor", () => {
  it("without leaving the page", async () => {
    render(
      <AdvisorSidebar>
        <HelpMenu variant="bar" side="teacher" />
      </AdvisorSidebar>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("button", { name: /How do I do something on the platform/ }));

    expect(await screen.findByRole("dialog", { name: "Studio advisor" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "What do you need help with?" })).toBeNull();
  });

  it("outside the studio, without Advisor, the same choice leads to the help center", () => {
    render(<HelpMenu variant="bar" side="teacher" />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));

    expect(screen.getByRole("link", { name: /How do I do something on the platform/ })).toHaveAttribute("href", "/help");
    expect(screen.getByRole("link", { name: /My students/ })).toHaveAttribute("href", "/teach/messages");
    expect(screen.getByRole("link", { name: /Account, payment or error/ })).toHaveAttribute("href", "/support");
  });
});
