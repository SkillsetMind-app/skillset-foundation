import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LegalGateContext } from "@/components/auth/legal-gate-state";
import { WelcomeTour } from "@/components/learn/welcome-tour";
import { TeacherWelcomeTour } from "@/components/teacher/teacher-welcome-tour";
import { I18nProvider } from "@/components/i18n/i18n-provider";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ rpc }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// P-24: the tour covers the whole screen on the first login and offers two
// explicit exits — the X (16px icon + 4px padding = 24px) and the "Skip" (text
// with no padding, 20px tall). Less than half of the 44px minimum target that the
// house itself fixes in .button-solid/.button-outline, inside the same modal.
// jsdom does not measure layout, so what can be bitten is the size class.
describe("welcome tour exits", () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  // C-17: in the teacher tour only the footer "Skip" stayed (and Esc);
  // the X ("Skip the tour") did the same thing. The exit that remains has a
  // visible name and a 44px target.
  it("in the teacher tour, the only exit (Skip) has a name and a 44px target", async () => {
    render(<TeacherWelcomeTour userId="teacher-1" firstName="Ana" />);

    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByRole("button", { name: "Skip the tour" })).toBeNull();
    expect(within(dialog).getAllByRole("button", { name: /skip/i })).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "Skip" })).toHaveClass("min-h-11");
  });

  // C-17: switching steps does not change the height (the steps in the same grid
  // cell), focus goes to the new title and only the current step exists for the
  // screen reader. The dashes do not animate width. O-11: there are two steps.
  it("in the teacher tour, the height does not jump and focus goes to the step title", async () => {
    render(<TeacherWelcomeTour userId="teacher-steady" firstName="Ana" />);
    const dialog = await screen.findByRole("dialog");
    const titles = dialog.querySelectorAll("h2");
    expect(titles).toHaveLength(2);
    const stack = titles[0].parentElement!.parentElement!;
    expect(stack).toHaveClass("grid");
    for (const title of titles) expect(title.parentElement).toHaveClass("[grid-area:1/1]");
    // On opening it is the dialog that enters; the text does not rise with it.
    expect(titles[0].parentElement).not.toHaveClass("motion-panel-in");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const current = screen.getByRole("heading", { name: "Create your first product" });
    expect(current).toHaveFocus();
    expect(current.parentElement).toHaveClass("motion-panel-in");
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(dialog).toHaveAccessibleName("Create your first product");
    const dots = dialog.querySelectorAll("[aria-hidden='true'] > span.rounded-full");
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      expect(dot).toHaveClass("w-6");
      expect(dot.className).not.toContain("transition-all");
    }

    // Going back to step 1 takes the "Back" off the screen: focus does not fall behind the dialog.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Welcome to your studio, Ana" })).toHaveFocus();
  });

  // C-17: in the learner tour the X ("Skip the tour") and the "Skip" did the same
  // thing; only the footer "Skip" stayed (and Esc). The exit that remains still has
  // a visible name and a 44px target.
  it("in the learner tour, the only exit (Skip) has a name and a 44px target", async () => {
    render(<WelcomeTour userId="student-1" firstName="Ana" />);

    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByRole("button", { name: "Skip the tour" })).toBeNull();
    expect(within(dialog).getAllByRole("button", { name: /skip/i })).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "Skip" })).toHaveClass("min-h-11");
  });

  it("in the learner tour, a name with $& shows up literally, without becoming '{name}'", async () => {
    // In a replace without a callback, "$&" becomes the matched piece ("{name}") and "$'" the
    // rest of the sentence. The name comes from sign-up: it is the person's text, not ours.
    render(<WelcomeTour userId="student-1" firstName="Mc$&Donald" />);

    expect(await screen.findByRole("heading", { name: "Welcome, Mc$&Donald" })).toBeInTheDocument();
  });

  it.each(["en", "es"] as const)("localizes the creator steps and current help location (%s)", async (locale) => {
    render(<I18nProvider initialLocale={locale}><TeacherWelcomeTour userId={`locale-${locale}`} firstName="Mc$&Donald" /></I18nProvider>);
    expect(await screen.findByRole("heading", { name: locale === "en" ? "Welcome to your studio, Mc$&Donald" : "Bienvenido a tu espacio, Mc$&Donald" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Next" : "Siguiente" }));
    // Help lives in the menu (sidebar; on the phone, inside the drawer), not at the top.
    expect(screen.getByText(locale === "en" ? /Help in the menu/ : /Ayuda en el menú/)).toBeInTheDocument();
    // The advisor is open on every account: the tour no longer ties it to a fee.
    expect(screen.queryByText(/active storefront|tienda activa/)).not.toBeInTheDocument();
    // With no product, the last page leads to creating the first one, instead of just closing.
    const create = screen.getByRole("link", { name: locale === "en" ? "Create my first product" : "Crear mi primer producto" });
    expect(create).toHaveAttribute("href", "/teach/builder?newCourse=1&format=course");
    expect(screen.queryByRole("button", { name: locale === "en" ? "Open your studio" : "Abrir mi espacio" })).not.toBeInTheDocument();
    // The link leads to creating AND closes the tour right away.
    fireEvent.click(create);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("with a product, the last page only closes the tour ('Open your studio')", async () => {
    render(<TeacherWelcomeTour userId="teacher-with-product" firstName="Ana" hasProducts />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByRole("link", { name: "Create my first product" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open your studio" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // The little round icon of each step became an engraving strip with the scene
  // of the step: product and lesson. O-11: on the second step the tour ends (no "Next").
  it("in the teacher tour, each step shows its engraving scene", async () => {
    render(<TeacherWelcomeTour userId="teacher-scenes" firstName="Ana" />);
    const dialog = await screen.findByRole("dialog");
    const scenes: string[] = [];
    for (let step = 0; step < 2; step += 1) {
      const art = dialog.querySelector("svg[data-scene]")!;
      expect(art).toHaveAttribute("aria-hidden", "true");
      scenes.push(art.getAttribute("data-scene")!);
      if (step < 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(scenes).toEqual(["firstProduct", "firstLesson"]);
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });
});

// How many steps each tour has (O-11: the teacher's one stayed with two).
describe.each([
  ["teacher", TeacherWelcomeTour, 2],
  ["student", WelcomeTour, 4],
] as const)("first welcome for %s", (surface, Tour, stepCount) => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
    localStorage.clear();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("lets narrow footer actions wrap instead of squeezing their labels", async () => {
    await act(async () => { render(<Tour userId="narrow-footer" firstName="Ana" />); });
    for (let step = 0; step < stepCount - 1; step += 1) fireEvent.click(screen.getByRole("button", { name: /^Next$/ }));
    const actions = screen.getByRole("button", { name: /^Back$/ }).parentElement!;
    expect(actions.parentElement).toHaveClass("flex-wrap");
    expect(actions).toHaveClass("flex-wrap", "max-w-full");
    for (const button of within(actions).getAllByRole("button")) expect(button).toHaveClass("shrink-0");
  });

  // The terms dialog comes first: with both open, Tab trapped in the tour
  // left focus behind it. While it waits, the tour does not even ask for the "seen" mark.
  it("waits for the legal window: no claim and no dialog while it is open, then opens", async () => {
    const gated = (waiting: boolean) => (
      <LegalGateContext.Provider value={waiting}><Tour userId="legal-first" firstName="Ana" /></LegalGateContext.Provider>
    );
    const { rerender } = render(gated(true));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();

    rerender(gated(false));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("claim_welcome_tour", { p_uid: "legal-first", p_surface: surface });
  });

  it("waits for the account claim before interrupting the page", async () => {
    let resolve!: (result: { data: boolean; error: null }) => void;
    rpc.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<Tour userId="pending" firstName="Ana" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("claim_welcome_tour", { p_uid: "pending", p_surface: surface }));
    await act(async () => resolve({ data: true, error: null }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("does not repeat a remotely seen tour in an empty browser", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await act(async () => { render(<Tour userId="already-seen" firstName="Ana" />); });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shares the pending claim during StrictMode and closes with Escape", async () => {
    // Flush the claim and passive keyboard effect before simulating a keypress.
    await act(async () => { render(<StrictMode><Tour userId="strict" firstName="Ana" /></StrictMode>); });
    await screen.findByRole("dialog");
    expect(rpc).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    cleanup();
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await act(async () => { render(<Tour userId="strict" firstName="Ana" />); });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a late claim after switching accounts", async () => {
    let resolve!: (result: { data: boolean; error: null }) => void;
    rpc.mockReturnValueOnce(new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce({ data: false, error: null });
    const { rerender } = render(<Tour key="a" userId="a" firstName="Ana" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    rerender(<Tour key="b" userId="b" firstName="Bea" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    await act(async () => resolve({ data: true, error: null }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rpc).toHaveBeenLastCalledWith("claim_welcome_tour", { p_uid: "b", p_surface: surface });
  });

  it.each(["transport", "server", "malformed"])("does not open on a %s failure and permits a later retry", async (failure) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    if (failure === "transport") rpc.mockRejectedValueOnce(new Error("private backend detail"));
    else rpc.mockResolvedValueOnce(failure === "server"
      ? { data: null, error: { message: "private backend detail" } }
      : { data: "true", error: null });
    render(<Tour userId={`failed-${failure}`} firstName="Ana" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private backend detail");
    cleanup();
    render(<Tour userId={`failed-${failure}`} firstName="Ana" />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("works without browser storage access", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    render(<Tour userId="no-storage" firstName="Ana" />);
    await screen.findByRole("dialog");
    // "Skip" exists in both tours (in the learner's it is the only exit).
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
