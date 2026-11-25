import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextLessonCard } from "@/components/learn/next-lesson-card";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { Lesson } from "@/domain/learning";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

// The automatic advance existed, but in silence: the lesson changed with no notice, no
// "cancel", and the next video did not start playing. Now a card over the
// video counts 5 s with "Watch now" and "Cancel"; with no action, the next one plays.

// The countdown lives only in the ring (before, also in "NEXT LESSON IN 4S", on top).
function ring() {
  return document.querySelector(".member-next-lesson__ring");
}

const lesson = {
  id: "l2",
  title: "Lesson two",
  type: "video",
  duration: "7 min",
  isPreview: false,
} as unknown as Lesson;

describe("NextLessonCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("translates a running countdown without restarting it or replacing the focused button", () => {
    const onPlay = vi.fn();
    render(<I18nProvider initialLocale="en"><ChangeLanguage />
      <NextLessonCard lesson={lesson} onPlay={onPlay} onCancel={vi.fn()} />
    </I18nProvider>);
    for (let tick = 0; tick < 3; tick += 1) act(() => { vi.advanceTimersByTime(1000); });
    const button = screen.getByRole("button", { name: "Watch now" });
    button.focus();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("region", { name: "Siguiente lección" })).toBeInTheDocument();
    expect(ring()).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Ver ahora" })).toBe(button);
    expect(button).toHaveFocus();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onPlay).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("keeps cancellation pending for the same exit delay after changing locale", () => {
    const onPlay = vi.fn();
    const onCancel = vi.fn();
    render(<I18nProvider initialLocale="en"><ChangeLanguage />
      <NextLessonCard lesson={lesson} onPlay={onPlay} onCancel={onCancel} />
    </I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(79); });
    expect(onCancel).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("shows the next lesson and the 5 s countdown", () => {
    render(<NextLessonCard lesson={lesson} onPlay={() => {}} onCancel={() => {}} />);

    expect(screen.getByRole("region", { name: "Next lesson" })).toBeInTheDocument();
    expect(screen.getByText("Lesson two")).toBeInTheDocument();
    expect(ring()).toHaveTextContent("5");
    // The number shows up only once: the line above says just "Next lesson".
    expect(screen.queryByText(/Next lesson in/)).toBeNull();
  });

  it("the screen reader hears the notice ONCE; the changing countdown stays outside the live region", () => {
    // Before, the whole card was aria-live and the number changed every second:
    // the reader re-read the card five times.
    render(<NextLessonCard lesson={lesson} onPlay={() => {}} onCancel={() => {}} />);

    const card = screen.getByRole("region", { name: "Next lesson" });
    expect(card).not.toHaveAttribute("aria-live");
    // The live region starts empty and gets the text later: text that is already there
    // at mount is usually not read.
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    act(() => { vi.advanceTimersByTime(50); });
    const text = "Next lesson starts in 5 seconds: Lesson two. Choose Cancel to stay on this lesson.";
    expect(status).toHaveTextContent(text);
    expect(ring()).toHaveAttribute("aria-hidden", "true");

    // 50ms have already passed: this completes the first second and two more.
    act(() => { vi.advanceTimersByTime(950); });
    for (let tick = 0; tick < 2; tick += 1) act(() => { vi.advanceTimersByTime(1000); });
    // The announced text does not change with the tick; only the visible number does.
    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(ring()).toHaveTextContent("2");
    expect(card.querySelectorAll("[aria-live]")).toHaveLength(0);
  });

  it("'Cancel' makes the card GO DOWN and only then notifies the parent; onPlay never", () => {
    // Before, the card appeared and disappeared abruptly, with nothing between one frame and the next.
    const onPlay = vi.fn();
    const onCancel = vi.fn();
    render(<NextLessonCard lesson={lesson} onPlay={onPlay} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Still on screen, leaving: the parent only unmounts when the animation ends.
    expect(screen.getByRole("region", { name: "Next lesson" })).toHaveClass("is-leaving");
    expect(onCancel).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(179);
    });
    expect(onCancel).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    // And the countdown stopped with it: even after 5 s the card does not switch lessons.
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("slides up with a fade — an animation, not an abrupt appearance", () => {
    render(<NextLessonCard lesson={lesson} onPlay={() => {}} onCancel={() => {}} />);

    // The entry animation lives in the CSS, in the card class.
    expect(screen.getByRole("region", { name: "Next lesson" })).toHaveClass(
      "member-next-lesson",
    );
    expect(screen.getByRole("region", { name: "Next lesson" })).not.toHaveClass("is-leaving");
    // A region, not a dialog: the card does not trap focus or block the video.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("'Watch now' plays right away", () => {
    const onPlay = vi.fn();
    render(<NextLessonCard lesson={lesson} onPlay={onPlay} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Watch now/ }));

    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("with no action, it plays on its own after 5 s — and not before", () => {
    const onPlay = vi.fn();
    render(<NextLessonCard lesson={lesson} onPlay={onPlay} onCancel={() => {}} />);

    // One tick per act: each second re-arms the timer in the effect, and the effect only
    // runs after the previous act flushes the state update.
    for (let tick = 0; tick < 4; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(onPlay).not.toHaveBeenCalled();
    expect(ring()).toHaveTextContent("1");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});

describe("the classroom uses the card instead of switching silently", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/learn/enrolled-course-workspace.tsx"),
    "utf8",
  );

  it("when the video ends, it proposes the next one (setNextUp) instead of selecting it directly", () => {
    const handler = source.slice(
      source.indexOf("async function handleLessonEnded"),
      source.indexOf("function playNextUp"),
    );

    // The rendered behavior (including the failure to save) is in
    // completion-and-advance.test.tsx; here only the shape of the video handler.
    expect(handler).toContain("setNextUp(next)");
    expect(handler).not.toContain("selectLesson(");
  });

  it("whoever accepts gets autoplay only on that lesson", () => {
    expect(source).toContain("autoplay={autoplayLessonId === selectedLesson.id}");
    expect(source).toContain("<NextLessonCard");
  });
});
