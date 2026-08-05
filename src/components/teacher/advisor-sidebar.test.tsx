import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdvisorSidebar } from "@/components/teacher/advisor-sidebar";

// Mutable so a test can sign a different teacher in without remounting — which
// is the whole point: the panel is layout-mounted and never unmounts.
const viewer = vi.hoisted(() => ({ uid: "teacher-1" }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: viewer.uid, roles: ["teacher"] } }),
}));

vi.mock("@/lib/advisor/config", () => ({ isAdvisorEnabled: true }));
vi.mock("@/lib/permissions", () => ({ hasAnyPermission: () => true }));
vi.mock("@/lib/ui/floating-action", () => ({
  announceFloatingAction: vi.fn(),
  onFloatingActionOpened: () => () => undefined,
}));

const fetchMock = vi.fn();

// One of the shipped starter prompts. Its presence is the tell that the panel
// settled into an empty thread, its absence that a stored one was restored.
const SUGGESTION = "How should I price my first course?";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function openAdvisor() {
  fireEvent.click(screen.getByRole("button", { name: "Open studio advisor" }));
}

function composer() {
  return screen.getByRole("textbox", { name: "Message to studio advisor" });
}

/** The JSON the component sent on the nth fetch call (0-indexed). */
function bodyOf(index: number): { conversationId?: string | null } {
  const init = fetchMock.mock.calls[index][1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe("AdvisorSidebar", () => {
  beforeEach(() => {
    viewer.uid = "teacher-1";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ conversationId: null, messages: [] }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("labels the composer and restores trigger focus after Escape", async () => {
    render(<AdvisorSidebar />);

    const trigger = screen.getByRole("button", { name: "Open studio advisor" });
    fireEvent.click(trigger);

    expect(
      screen.getByRole("textbox", { name: "Message to studio advisor" }),
    ).toHaveFocus();

    // Let the first-open history read settle before moving on, so it does not
    // land as an unacted state update after the test body finishes.
    await screen.findByRole("button", { name: SUGGESTION });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Studio advisor" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("uses the viewport-constrained panel layout", async () => {
    render(<AdvisorSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Open studio advisor" }));

    expect(screen.getByRole("dialog", { name: "Studio advisor" })).toHaveClass(
      "advisor-panel",
    );

    await screen.findByRole("button", { name: SUGGESTION });
  });

  it("restores the stored thread on the first open and does not re-read it on the next", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        conversationId: "conv-1",
        messages: [
          { role: "user", content: "Should I split this into two courses?" },
          { role: "assistant", content: "Keep it as one for now." },
        ],
      }),
    );

    render(<AdvisorSidebar />);
    openAdvisor();

    expect(await screen.findByText("Keep it as one for now.")).toBeInTheDocument();
    expect(screen.getByText("Should I split this into two courses?")).toBeInTheDocument();
    // Starter prompts belong to an empty thread, not to one already in progress.
    expect(screen.queryByRole("button", { name: SUGGESTION })).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    openAdvisor();

    // Effects are flushed by fireEvent's act(), so a second read would already
    // be recorded here rather than merely pending.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Keep it as one for now.")).toBeInTheDocument();
  });

  it("sends the restored conversation id, then the one the reply hands back", async () => {
    fetchMock.mockImplementation(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse({ reply: "Raise it by twenty.", conversationId: "conv-2" })
        : jsonResponse({
            conversationId: "conv-1",
            messages: [{ role: "assistant", content: "Where we left off." }],
          }),
    );

    render(<AdvisorSidebar />);
    openAdvisor();
    await screen.findByText("Where we left off.");

    fireEvent.change(composer(), { target: { value: "What about pricing?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    expect(await screen.findByText("Raise it by twenty.")).toBeInTheDocument();
    expect(bodyOf(1)).toMatchObject({ conversationId: "conv-1" });

    fireEvent.change(composer(), { target: { value: "And discounts?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    // The second reply is the same text as the first, so count the calls rather
    // than wait on a rendered string that now matches twice.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(bodyOf(2)).toMatchObject({ conversationId: "conv-2" });
  });

  it("falls back to an empty usable thread when the history cannot be read", async () => {
    fetchMock.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({ reply: "Happy to help.", conversationId: "conv-9" });
      }
      throw new Error("offline");
    });

    render(<AdvisorSidebar />);
    openAdvisor();

    const suggestion = await screen.findByRole("button", { name: SUGGESTION });
    // Silently: an unreachable transcript is not the teacher's problem to read.
    expect(screen.queryByText("Loading your conversation…")).toBeNull();

    fireEvent.click(suggestion);

    expect(await screen.findByText("Happy to help.")).toBeInTheDocument();
    expect(bodyOf(1)).toMatchObject({ conversationId: null });
  });

  it("refuses to send while the history is loading, and keeps the draft", async () => {
    let releaseHistory: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse({ reply: "Noted.", conversationId: "conv-3" })
        : new Promise<Response>((resolve) => {
            releaseHistory = resolve;
          }),
    );

    render(<AdvisorSidebar />);
    openAdvisor();

    fireEvent.change(composer(), { target: { value: "Draft that must survive" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    expect(screen.getByText("Loading your conversation…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SUGGESTION })).toBeNull();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    // Only the GET. The turn was refused outright, not queued.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(composer()).toHaveValue("Draft that must survive");

    releaseHistory(
      jsonResponse({
        conversationId: "conv-1",
        messages: [{ role: "assistant", content: "Earlier advice." }],
      }),
    );

    expect(await screen.findByText("Earlier advice.")).toBeInTheDocument();
    expect(composer()).toHaveValue("Draft that must survive");

    fireEvent.keyDown(composer(), { key: "Enter" });

    expect(await screen.findByText("Noted.")).toBeInTheDocument();
    // The refused turn landed on top of the restored thread instead of erasing
    // it — which is the whole point of blocking the send rather than hiding it.
    expect(screen.getByText("Draft that must survive")).toBeInTheDocument();
    expect(screen.getByText("Earlier advice.")).toBeInTheDocument();
  });

  it("drops the previous teacher's thread when a different teacher signs in", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        viewer.uid === "teacher-1"
          ? {
              conversationId: "conv-a",
              messages: [{ role: "assistant", content: "Teacher one's advice." }],
            }
          : {
              conversationId: "conv-b",
              messages: [{ role: "assistant", content: "Teacher two's advice." }],
            },
      ),
    );

    const view = render(<AdvisorSidebar />);
    openAdvisor();
    expect(await screen.findByText("Teacher one's advice.")).toBeInTheDocument();

    // No remount: the layout keeps this component alive across a sign-out, so
    // the incoming teacher inherits whatever state the last one left behind.
    viewer.uid = "teacher-2";
    view.rerender(<AdvisorSidebar />);

    expect(await screen.findByText("Teacher two's advice.")).toBeInTheDocument();
    expect(screen.queryByText("Teacher one's advice.")).toBeNull();

    // And the id followed the thread: the next turn must not append to conv-a.
    fireEvent.change(composer(), { target: { value: "Where do I start?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(bodyOf(2)).toMatchObject({ conversationId: "conv-b" });
  });

  it("ignores a history load the signed-in teacher changed out from under", async () => {
    let releaseFirst: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation(async () =>
      viewer.uid === "teacher-1"
        ? new Promise<Response>((resolve) => {
            releaseFirst = resolve;
          })
        : jsonResponse({
            conversationId: "conv-b",
            messages: [{ role: "assistant", content: "Teacher two's advice." }],
          }),
    );

    const view = render(<AdvisorSidebar />);
    openAdvisor();

    viewer.uid = "teacher-2";
    view.rerender(<AdvisorSidebar />);
    expect(await screen.findByText("Teacher two's advice.")).toBeInTheDocument();

    // Teacher one's read finally lands, addressed to a panel that moved on.
    // act() drains the microtasks, so an unguarded setMessages would have run
    // by the assertion rather than merely being queued behind it.
    await act(async () => {
      releaseFirst(
        jsonResponse({
          conversationId: "conv-a",
          messages: [{ role: "assistant", content: "Teacher one's advice." }],
        }),
      );
    });

    expect(screen.queryByText("Teacher one's advice.")).toBeNull();
    expect(screen.getByText("Teacher two's advice.")).toBeInTheDocument();
  });

  it("renders a restored reply as prose but leaves the teacher's own words alone", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        conversationId: "conv-1",
        messages: [
          { role: "user", content: "Is **this** the right split?" },
          { role: "assistant", content: "**Raise** it to $49." },
        ],
      }),
    );

    render(<AdvisorSidebar />);
    openAdvisor();

    // Stored raw, so without a strip on this path the reply reads "**Raise**"
    // after a reload and plain "Raise" before one — same message, two looks.
    expect(await screen.findByText("Raise it to $49.")).toBeInTheDocument();
    expect(screen.getByText("Is **this** the right split?")).toBeInTheDocument();
  });

  it("shows the advisor's own explanation when a question is refused", async () => {
    fetchMock.mockImplementation(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse(
            { error: "That question was too broad for the advisor to finish." },
            502,
          )
        : jsonResponse({ conversationId: null, messages: [] }),
    );

    render(<AdvisorSidebar />);
    openAdvisor();
    await screen.findByRole("button", { name: SUGGESTION });

    fireEvent.change(composer(), { target: { value: "Explain everything." } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    // 502 has no branch of its own; it must fall through to the generic notice
    // carrying the route's copy, not a swallowed "something went wrong".
    expect(
      await screen.findByText("That question was too broad for the advisor to finish."),
    ).toBeInTheDocument();
  });
});
