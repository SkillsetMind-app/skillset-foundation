import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";

import { CourseShareLink } from "./course-share-link";

// The I18nProvider asks for the router to refresh when the language changes. Here
// nobody switches, but the hook has to exist outside Next.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const title = "Coaching & Sales 101";
// Literals, not encodeURIComponent: the proof is that the "&" and the spaces in the title
// do not break the query string of any network.
const encodedTitle = "Coaching%20%26%20Sales%20101";
const encodedUrl = "https%3A%2F%2Fwww.skillsetmind.com%2Fcourses%2Fcourse-1";

describe("CourseShareLink", () => {
  it("shows and copies the permanent public URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout?offer=LAUNCH" title={title} />);
    const url = "https://www.skillsetmind.com/courses/course-1/checkout?offer=LAUNCH";
    expect(screen.getByText(url)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Checkout" })).toHaveAttribute("href", url);
    fireEvent.click(screen.getByRole("button", { name: "Copy Checkout link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied.");
    expect(writeText).toHaveBeenCalledWith(url);
  });

  // The checkout link is what the teacher pastes in an ad and a story: in production
  // it goes out on the short payment host, with the offer preserved, and that is the URL
  // that is shown, copied, opened and sent to the networks.
  it("publishes a checkout link on pay.skillsetmind.com in production, offer included", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("location", { ...window.location, hostname: "www.skillsetmind.com" });
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout?offer=LAUNCH" title={title} entry="pay" />);
    const url = "https://pay.skillsetmind.com/courses/course-1/checkout?offer=LAUNCH";
    expect(screen.getByText(url)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Checkout" })).toHaveAttribute("href", url);
    fireEvent.click(screen.getByRole("button", { name: "Copy Checkout link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied.");
    expect(writeText).toHaveBeenCalledWith(url);

    fireEvent.click(screen.getByRole("button", { name: "Share Checkout" }));
    const menu = screen.getByRole("menu", { name: "Checkout share options" });
    const encodedPayUrl = "https%3A%2F%2Fpay.skillsetmind.com%2Fcourses%2Fcourse-1%2Fcheckout%3Foffer%3DLAUNCH";
    expect(within(menu).getByRole("menuitem", { name: "WhatsApp" })).toHaveAttribute("href", `https://wa.me/?text=${encodedTitle}%20${encodedPayUrl}`);
    expect(within(menu).getByRole("menuitem", { name: "LinkedIn" })).toHaveAttribute("href", `https://www.linkedin.com/sharing/share-offsite/?url=${encodedPayUrl}`);
  });

  // Outside production the short host does not resolve; the link stays relative so that
  // whoever tests on a Vercel preview stays on the preview instead of landing in production.
  it.each(["skillset-foundation-git-feat-links-skillsetmind.vercel.app", "localhost"])(
    "keeps a checkout link relative when viewed from %s",
    (hostname) => {
      vi.stubGlobal("location", { ...window.location, hostname });
      render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout?offer=LAUNCH" title={title} entry="pay" />);
      const url = "/courses/course-1/checkout?offer=LAUNCH";
      expect(screen.getByText(url)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open Checkout" })).toHaveAttribute("href", url);
      expect(document.body.innerHTML).not.toContain("pay.skillsetmind.com");
    },
  );

  it("leaves the product page on www even in production, because only checkout moves to pay.", () => {
    vi.stubGlobal("location", { ...window.location, hostname: "www.skillsetmind.com" });
    render(<CourseShareLink label="Product page" path="/courses/course-1" title={title} />);
    expect(screen.getByRole("link", { name: "Open Product page" })).toHaveAttribute("href", "https://www.skillsetmind.com/courses/course-1");
  });

  // Copy is a secondary action: outline. The "copied" state shows on the button itself
  // for 2s (the box does not grow), and the button's name follows the text: a fixed
  // aria-label of "Copy ..." would contradict the screen's "Link copied.".
  it("copy is an outline button whose own label says copied for two seconds", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />);
    const copy = screen.getByRole("button", { name: "Copy Checkout link" });
    expect(copy).toHaveClass("button-outline");
    expect(copy).not.toHaveClass("button-solid");
    vi.useFakeTimers();
    try {
      await act(async () => fireEvent.click(copy));
      expect(copy).toHaveTextContent("Link copied.");
      expect(copy).toHaveAccessibleName("Link copied.");
      expect(screen.getByRole("status")).toHaveClass("sr-only");
      act(() => vi.advanceTimersByTime(2000));
      expect(copy).toHaveTextContent("Copy link");
      expect(copy).toHaveAccessibleName("Copy Checkout link");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("compact: only the copy button, and the URL appears if copying fails", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} compact />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share Checkout" })).not.toBeInTheDocument();
    expect(screen.queryByText("https://www.skillsetmind.com/courses/course-1/checkout")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy Checkout link" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("https://www.skillsetmind.com/courses/course-1/checkout")).toBeInTheDocument();
  });

  it("announces denied clipboard permission and keeps the URL available", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Checkout link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Copy the link above manually.");
    expect(screen.queryByText("Link copied.")).not.toBeInTheDocument();
    expect(screen.getByText("https://www.skillsetmind.com/courses/course-1/checkout")).toBeInTheDocument();
  });

  it("keeps the English labels byte for byte outside the provider", () => {
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />);
    expect(screen.getByRole("button", { name: "Copy Checkout link" })).toHaveTextContent("Copy link");
    expect(screen.getByRole("link", { name: "Open Checkout" })).toHaveTextContent("Open page");
    expect(screen.getByRole("button", { name: "Share Checkout" })).toHaveTextContent("Share");
  });

  it("speaks Spanish inside the provider, share menu included", () => {
    render(
      <I18nProvider initialLocale="es">
        <CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Copiar enlace de Checkout" })).toHaveTextContent("Copiar enlace");
    expect(screen.getByRole("link", { name: "Abrir Checkout" })).toHaveTextContent("Abrir página");
    fireEvent.click(screen.getByRole("button", { name: "Compartir Checkout" }));
    const menu = screen.getByRole("menu", { name: "Opciones para compartir Checkout" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "WhatsApp",
      "X",
      "LinkedIn",
      "Correo",
    ]);
  });

  it("opens a Share menu with WhatsApp, X, LinkedIn and email intents for title + URL", () => {
    render(<CourseShareLink label="Product page" path="/courses/course-1" title={title} />);
    const share = screen.getByRole("button", { name: "Share Product page" });
    expect(share).toHaveAttribute("aria-haspopup", "menu");
    expect(share).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(share);
    expect(share).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Product page share options" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "WhatsApp",
      "X",
      "LinkedIn",
      "Email",
    ]);
    expect(within(menu).getByRole("menuitem", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodedTitle}%20${encodedUrl}`,
    );
    expect(within(menu).getByRole("menuitem", { name: "X" })).toHaveAttribute(
      "href",
      `https://x.com/intent/post?text=${encodedTitle}&url=${encodedUrl}`,
    );
    expect(within(menu).getByRole("menuitem", { name: "LinkedIn" })).toHaveAttribute(
      "href",
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    );
    expect(within(menu).getByRole("menuitem", { name: "Email" })).toHaveAttribute(
      "href",
      `mailto:?subject=${encodedTitle}&body=${encodedTitle}%20${encodedUrl}`,
    );

    for (const name of ["WhatsApp", "X", "LinkedIn"]) {
      const item = within(menu).getByRole("menuitem", { name });
      expect(item).toHaveAttribute("target", "_blank");
      expect(item).toHaveAttribute("rel", "noopener noreferrer");
    }
    // The mailto opens the email app; a new tab would be a blank tab.
    expect(within(menu).getByRole("menuitem", { name: "Email" })).not.toHaveAttribute("target");
  });

  it("closes on Escape and hands focus back to the Share button", () => {
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />);
    const share = screen.getByRole("button", { name: "Share Checkout" });
    fireEvent.click(share);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(share).toHaveAttribute("aria-expanded", "false");
    expect(share).toHaveFocus();
  });

  // Focus stayed on the button and the arrows did not move: the menu only worked with Tab.
  it("opens with focus on the first target and moves with the arrow keys", () => {
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />);
    fireEvent.click(screen.getByRole("button", { name: "Share Checkout" }));
    const [whatsapp, x, , email] = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(whatsapp).toHaveFocus();
    fireEvent.keyDown(whatsapp, { key: "ArrowDown" });
    expect(x).toHaveFocus();
    fireEvent.keyDown(x, { key: "End" });
    expect(email).toHaveFocus();
    fireEvent.keyDown(email, { key: "ArrowDown" });
    expect(whatsapp).toHaveFocus();
  });

  it("choosing a target closes the menu and hands focus back to Share", () => {
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />);
    const share = screen.getByRole("button", { name: "Share Checkout" });
    fireEvent.click(share);
    fireEvent.click(screen.getByRole("menuitem", { name: "Email" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(share).toHaveFocus();
  });

  it("closes when focus tabs out of the button row, not while it moves inside", () => {
    render(
      <>
        <CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />
        <button type="button">Next on the page</button>
      </>,
    );
    const share = screen.getByRole("button", { name: "Share Checkout" });
    fireEvent.click(share);
    const email = screen.getByRole("menuitem", { name: "Email" });
    fireEvent.focusOut(email, { relatedTarget: share });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.focusOut(email, { relatedTarget: screen.getByRole("button", { name: "Next on the page" }) });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes when the pointer goes down outside the button row", () => {
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />);
    fireEvent.click(screen.getByRole("button", { name: "Share Checkout" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

// The publish milestone ("Published!" panel) takes focus to the brass button. But
// publishing waits for two network round trips and the fields stay editable: whoever clicked
// a field and kept typing lost the keys to the button, and a Space
// copied the link by accident.
describe("CourseShareLink no marco (focusCopy)", () => {
  function Page({ published }: { published: boolean }) {
    return (
      <>
        <input aria-label="Course title" />
        {published ? (
          <CourseShareLink
            label="Product page"
            path="/courses/course-1"
            title={title}
            copyLabel="Copy my page link"
            accent
            focusCopy
          />
        ) : null}
      </>
    );
  }

  it("moves focus to the copy button when nobody has it", () => {
    const { rerender } = render(<Page published={false} />);
    expect(document.activeElement).toBe(document.body);
    rerender(<Page published />);
    expect(screen.getByRole("button", { name: "Copy my page link" })).toHaveFocus();
  });

  it("does not steal focus from someone typing in another field", () => {
    const { rerender } = render(<Page published={false} />);
    const input = screen.getByLabelText("Course title");
    input.focus();
    rerender(<Page published />);
    expect(input).toHaveFocus();
    expect(screen.getByRole("button", { name: "Copy my page link" })).not.toHaveFocus();
  });

  it("at the milestone, Abrir and Compartilhar come out at the brass button size, and the menu drops down", () => {
    render(<Page published />);
    expect(screen.getByRole("button", { name: "Copy my page link" })).toHaveClass("button-accent", "button-lg");
    expect(screen.getByRole("link", { name: "Open Product page" })).toHaveClass("button-outline", "button-lg");
    const share = screen.getByRole("button", { name: "Share Product page" });
    expect(share).toHaveClass("button-outline", "button-lg");
    fireEvent.click(share);
    expect(screen.getByRole("menu")).toHaveClass("motion-drop-in");
  });
});
