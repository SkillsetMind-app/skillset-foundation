import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CourseCategorySelect } from "@/components/teacher/course-category-select";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";

const localeRouter = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => localeRouter }));

function SwitchLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Switch language</button>;
}

const options = [
  "Clinical Psychology & Approaches",
  "Hypnotherapy",
  "Mental Health Foundations",
] as const;

describe("CourseCategorySelect", () => {
  it("translates the open selector without changing canonical or author-written categories", () => {
    const onToggle = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <SwitchLanguage />
        <CourseCategorySelect
          options={["Personal Development", "Hypnosis & Guided Change"]}
          selected={["Personal Development", "Autor $$ $&"]}
          max={2}
          onToggle={onToggle}
        />
      </I18nProvider>,
    );
    const trigger = screen.getByRole("button", { name: /Personal Development/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("group", { name: "Categorías del curso" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Desarrollo personal/ })).toBe(trigger);
    expect(screen.getByRole("checkbox", { name: "Autor $$ $&" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Hipnosis y cambio guiado" })).toBeDisabled();
    expect(screen.getByTitle("Has seleccionado el máximo de categorías. Quita una para añadir otra.")).toBeInTheDocument();
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Desarrollo personal" }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("Personal Development");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens on demand, reports selections, and closes on Escape", () => {
    const onToggle = vi.fn();
    render(
      <CourseCategorySelect
        options={options}
        selected={["Hypnotherapy"]}
        onToggle={onToggle}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Hypnotherapy/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Course categories" })).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("group", { name: "Course categories" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Hypnotherapy" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mental Health Foundations" }),
    );
    expect(onToggle).toHaveBeenCalledWith("Mental Health Foundations");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Course categories" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("keeps legacy selections removable and enforces the selection cap", () => {
    const onToggle = vi.fn();
    render(
      <CourseCategorySelect
        options={options}
        selected={["Psychology", "Hypnotherapy"]}
        onToggle={onToggle}
        max={2}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Psychology/i }));

    expect(screen.getByRole("checkbox", { name: "Psychology" })).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: "Clinical Psychology & Approaches" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Psychology" }));
    expect(onToggle).toHaveBeenCalledWith("Psychology");
  });
});
