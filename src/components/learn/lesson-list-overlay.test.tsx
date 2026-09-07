import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LessonListOverlay } from "@/components/learn/lesson-list-overlay";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { LessonUnlockState } from "@/domain/drip-policy";
import type { CourseModule, Lesson } from "@/domain/learning";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

function lesson(id: string, title: string): Lesson {
  return {
    id,
    title,
    type: "video",
    duration: "10 min",
    isPreview: false,
  };
}

const modules: CourseModule[] = [
  {
    id: "m1",
    title: "Foundations",
    summary: "",
    lessons: [lesson("l1", "Welcome"), lesson("l2", "Setting the frame")],
  },
  {
    id: "m2",
    title: "Practice",
    summary: "",
    lessons: [lesson("l3", "First session"), lesson("l4", "Debrief")],
  },
];

const unlocked: LessonUnlockState = {
  unlocked: true,
  unlocksAt: null,
  reason: "available",
};

function renderOverlay(overrides: { onSelect?: () => void; onClose?: () => void } = {}) {
  const onSelect = overrides.onSelect ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();

  render(
    <LessonListOverlay
      modules={modules}
      selectedLessonId="l1"
      completedLessonIds={["l1"]}
      unlockStateById={
        new Map(modules.flatMap((m) => m.lessons).map((l) => [l.id, unlocked]))
      }
      onSelect={onSelect}
      onClose={onClose}
    />,
  );

  return { onSelect, onClose };
}

describe("LessonListOverlay", () => {
  it("localizes the open dialog without losing search, focus or absolute lesson numbering", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const title = "Debrief $$50 $&";
    const localizedModules = modules.map((module) => ({ ...module, lessons: module.lessons.map((item) => item.id === "l4" ? { ...item, title } : item) }));
    render(<I18nProvider initialLocale="en"><ChangeLanguage />
      <LessonListOverlay modules={localizedModules} selectedLessonId="l1" completedLessonIds={["l1"]}
        unlockStateById={new Map()} onSelect={onSelect} onClose={onClose} />
    </I18nProvider>);
    const dialog = screen.getByRole("dialog", { name: "All lessons" });
    const search = screen.getByRole("searchbox", { name: "Search lessons" });
    fireEvent.change(search, { target: { value: "$$50 $&" } });
    search.focus();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("dialog", { name: "Todas las lecciones" })).toBe(dialog);
    expect(screen.getByRole("searchbox", { name: "Buscar lecciones" })).toBe(search);
    expect(search).toHaveFocus();
    expect(search).toHaveValue("$$50 $&");
    expect(screen.getByText('1 lección coincide con "$$50 $&"')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Debrief/ })).toHaveTextContent("4");
    expect(screen.getAllByRole("button", { name: "Cerrar lista de lecciones" })).toHaveLength(2);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses Spanish plural and empty search copy", () => {
    render(<I18nProvider initialLocale="es"><LessonListOverlay modules={modules}
      selectedLessonId="l1" completedLessonIds={[]} unlockStateById={new Map()}
      onSelect={vi.fn()} onClose={vi.fn()} /></I18nProvider>);
    expect(screen.getByText("4 lecciones en este curso")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByText('0 lecciones coinciden con "missing"')).toBeInTheDocument();
    expect(screen.getByText("Ninguna lección coincide con la búsqueda.")).toBeInTheDocument();
  });
  it("keeps thumbnails and locked labels while filtering and selecting a lesson", () => {
    const onSelect = vi.fn();
    const { container } = render(<LessonListOverlay
      modules={modules} selectedLessonId="l1" completedLessonIds={[]}
      unlockStateById={new Map([["l3", { ...unlocked, unlocked: false }]])}
      thumbnailUrlByLessonId={new Map([["l3", "/lesson-three.png"]])}
      onSelect={onSelect} onClose={() => {}}
    />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "First session" } });
    expect(container.querySelector('img[src="/lesson-three.png"]')).toHaveAttribute("alt", "");
    const lesson = screen.getByRole("button", { name: /First session/ });
    expect(lesson).toHaveTextContent("Locked");
    fireEvent.click(lesson);
    expect(onSelect).toHaveBeenCalledWith("l3");
  });
  it("lists every module's lessons, not just the active one", () => {
    renderOverlay();

    expect(screen.getByRole("dialog", { name: "All lessons" })).toBeInTheDocument();
    expect(screen.getByText("Debrief")).toBeInTheDocument();
    expect(screen.getByText("4 lessons in this course")).toBeInTheDocument();
  });

  it("keeps absolute lesson numbers while the search filters the list", () => {
    renderOverlay();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "debrief" },
    });

    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
    // "Debrief" is the 4th lesson of the course, and stays the 4th after filtering.
    expect(screen.getByRole("button", { name: /Debrief/ })).toHaveTextContent("4");
  });

  it("selects the lesson and closes", () => {
    const { onSelect, onClose } = renderOverlay();

    fireEvent.click(screen.getByRole("button", { name: /First session/ }));

    expect(onSelect).toHaveBeenCalledWith("l3");
    expect(onClose).toHaveBeenCalled();
  });
});
