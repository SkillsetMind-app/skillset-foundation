import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoursePlaylist } from "@/components/learn/course-playlist";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { LessonUnlockState } from "@/domain/drip-policy";
import type { CourseModule } from "@/domain/learning";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

// The lesson list existed three times in the classroom and none was visible with the
// video playing. Now it is ONE playlist beside the video: modules in an accordion,
// current lesson highlighted, check and lock per lesson, search at the top.

const modules = [
  {
    id: "m1",
    title: "Basics",
    lessons: [
      { id: "l1", title: "Welcome", type: "video", duration: "3 min", isPreview: true },
      { id: "l2", title: "Setup", type: "video", duration: "5 min", isPreview: false },
    ],
  },
  {
    id: "m2",
    title: "Advanced",
    lessons: [
      { id: "l3", title: "Deep dive", type: "video", duration: "9 min", isPreview: false },
    ],
  },
] as unknown as CourseModule[];

const unlockStateById = new Map<string, LessonUnlockState>([
  ["l3", { unlocked: false, unlocksAt: null, reason: "drip" } as unknown as LessonUnlockState],
]);

function renderPlaylist(overrides: Partial<Parameters<typeof CoursePlaylist>[0]> = {}) {
  return render(
    <CoursePlaylist
      modules={modules}
      selectedLessonId="l2"
      completedLessonIds={["l1"]}
      unlockStateById={unlockStateById}
      onSelect={() => {}}
      {...overrides}
    />,
  );
}

describe("CoursePlaylist", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("keeps the search, focus and selected lesson while localizing literal results", () => {
    const title = "Practice $$50 $&";
    const localizedModules = [{ ...modules[0], lessons: [{ ...modules[0].lessons[0], title }] }];
    const onSelect = vi.fn();
    const onUncomplete = vi.fn();
    render(<I18nProvider initialLocale="en">
      <ChangeLanguage />
      <CoursePlaylist modules={localizedModules} selectedLessonId="l1" completedLessonIds={["l1"]}
        unlockStateById={unlockStateById} onSelect={onSelect} onUncomplete={onUncomplete} />
    </I18nProvider>);
    const search = screen.getByRole("searchbox", { name: "Search lessons" });
    fireEvent.change(search, { target: { value: "$$50 $&" } });
    search.focus();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("navigation", { name: "Lecciones" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Buscar lecciones" })).toBe(search);
    expect(search).toHaveValue("$$50 $&");
    expect(search).toHaveFocus();
    expect(screen.getByText('1 lección coincide con "$$50 $&"')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Marcar "${title}" como incompleta` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Practice/ })).toHaveAttribute("aria-current", "true");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onUncomplete).not.toHaveBeenCalled();
  });

  it("keeps collapsed modules and locked navigation when the locale changes", () => {
    const onSelect = vi.fn();
    render(<I18nProvider initialLocale="en"><ChangeLanguage />
      <CoursePlaylist modules={modules} selectedLessonId="l2" completedLessonIds={["l1"]}
        unlockStateById={unlockStateById} onSelect={onSelect} />
    </I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Basics/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: /Módulo 1 Basics/ })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    const locked = screen.getByRole("button", { name: /Deep dive/ });
    expect(locked).toHaveTextContent("Bloqueada");
    fireEvent.click(locked);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("l3");
  });

  it("shows a decorative thumbnail without changing locked lesson navigation", () => {
    const onSelect = vi.fn();
    const { container } = renderPlaylist({ onSelect, thumbnailUrlByLessonId: new Map([["l3", "/lesson-three.png"]]) });
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(container.querySelector('img[src="/lesson-three.png"]')).toHaveAttribute("alt", "");
    const lesson = screen.getByRole("button", { name: /Deep dive/ });
    expect(lesson).toHaveTextContent("Locked");
    fireEvent.click(lesson);
    expect(onSelect).toHaveBeenCalledWith("l3");
  });

  it("highlights the current lesson, opens only its module and closes the others", () => {
    renderPlaylist();

    expect(screen.getByRole("button", { name: /Setup/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /Welcome/ })).not.toHaveAttribute("aria-current");

    // Module 2 starts closed: its lesson is not on screen.
    const advanced = screen.getByRole("button", { name: /Advanced/ });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Deep dive")).not.toBeInTheDocument();

    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute("aria-expanded", "true");
    // A lesson locked by drip: lock + "Locked" on the row.
    expect(screen.getByRole("button", { name: /Deep dive/ })).toHaveTextContent(/Locked/);
  });

  it("choosing a lesson calls onSelect with its id", () => {
    const onSelect = vi.fn();
    renderPlaylist({ onSelect });

    fireEvent.click(screen.getByRole("button", { name: /Welcome/ }));

    expect(onSelect).toHaveBeenCalledWith("l1");
  });

  it("in the list only the completed lesson's check is clickable — to undo; there is no 'Mark complete'", () => {
    const onUncomplete = vi.fn();
    renderPlaylist({ onUncomplete });

    fireEvent.click(screen.getByRole("button", { name: 'Mark "Welcome" incomplete' }));
    expect(onUncomplete).toHaveBeenCalledWith("l1");

    expect(
      screen.queryByRole("button", { name: /Mark "Setup" incomplete/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Mark complete/ })).not.toBeInTheDocument();
  });

  // The undo check measured 28px: a target too small for a finger. jsdom does not
  // do layout, so the proof is the stylesheet (the members-area-hero.test pattern).
  it("the check that undoes has a 44px touch target", () => {
    renderPlaylist({ onUncomplete: vi.fn() });
    expect(screen.getByRole("button", { name: 'Mark "Welcome" incomplete' })).toHaveClass(
      "member-playlist__status--button",
    );

    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const rule = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`);
      expect(start, `${selector} is not in globals.css`).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("\n}", start));
    };
    const size = Number(/\swidth:\s*(\d+)px/.exec(rule(".member-playlist__status"))?.[1]);
    const inset = Number(/inset:\s*-(\d+)px/.exec(rule(".member-playlist__status--button::after"))?.[1]);
    expect(rule(".member-playlist__status--button")).toMatch(/position:\s*relative/);
    expect(size + 2 * inset).toBeGreaterThanOrEqual(44);
  });

  it("lesson without duration: the line does not start with a stray separator", () => {
    renderPlaylist({
      modules: [{ ...modules[0], lessons: modules[0].lessons.map((lesson) => ({ ...lesson, duration: "" })) }],
    });

    const welcome = screen.getByRole("button", { name: /Welcome/ });
    expect(welcome.querySelector(".member-playlist__lesson-meta")?.textContent).toBe("Completed");
  });

  it("without onUncomplete (teacher preview) the check is just an icon", () => {
    renderPlaylist({ onUncomplete: undefined });

    expect(
      screen.queryByRole("button", { name: /Mark "Welcome" incomplete/ }),
    ).not.toBeInTheDocument();
  });

  it("search filters, opens the modules with results and does NOT renumber", () => {
    const { container } = renderPlaylist();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search lessons" }), {
      target: { value: "deep" },
    });

    expect(screen.getByText(/1 lesson match/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deep dive/ })).toBeInTheDocument();
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search lessons" }), {
      target: { value: "setup" },
    });
    // "Setup" is the 2nd lesson of the course — it stays "2" even though it is the only one on screen.
    // (The current lesson shows the play icon; we force another selection in the next test.)
    expect(container.querySelectorAll(".member-playlist__lesson")).toHaveLength(1);
  });

  it("a scheduled lesson shows the date it opens, not just 'Locked'", () => {
    const scheduled = new Map<string, LessonUnlockState>([
      ["l3", { unlocked: false, unlocksAt: new Date("2026-03-05T12:00:00.000Z"), reason: "scheduled" }],
    ]);
    renderPlaylist({ unlockStateById: scheduled });

    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));

    expect(screen.getByRole("button", { name: /Deep dive/ })).toHaveTextContent("Unlocks Mar 5, 2026");
  });

  it("switching lessons scrolls the list to the current lesson — the person does not lose their place", () => {
    // The current lesson was highlighted, but the list stayed where it was: the highlight
    // fell outside the visible area and the person had to hunt for where they stopped.
    const scrolled: Array<{ element: Element; options: unknown }> = [];
    Element.prototype.scrollIntoView = function scrollIntoView(
      this: Element,
      options?: unknown,
    ) {
      scrolled.push({ element: this, options });
    } as Element["scrollIntoView"];

    const { rerender } = renderPlaylist({ selectedLessonId: "l1" });
    scrolled.length = 0;

    rerender(
      <CoursePlaylist
        modules={modules}
        selectedLessonId="l2"
        completedLessonIds={["l1"]}
        unlockStateById={unlockStateById}
        onSelect={() => {}}
      />,
    );

    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].element).toHaveClass("is-current");
    expect(scrolled[0].element).toHaveTextContent("Setup");
    // "nearest": scrolls the minimum, and does not move if the row is already in view.
    expect(scrolled[0].options).toMatchObject({ block: "nearest" });
  });

  it("numbering is for the whole course (the 2nd lesson is '2' even when filtered)", () => {
    const { container } = renderPlaylist({ selectedLessonId: "l1", completedLessonIds: [] });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search lessons" }), {
      target: { value: "setup" },
    });

    expect(container.querySelector(".member-playlist__status")?.textContent).toBe("2");
  });
});
