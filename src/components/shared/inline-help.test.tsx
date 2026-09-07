import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InlineHelp } from "@/components/shared/inline-help";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";

const localeRouter = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => localeRouter }));

function LocalizedHelp() {
  const { locale, setLocale, t } = useTranslation();
  return <>
    <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Switch language</button>
    <InlineHelp topic={t("creatorEditor.builder.pricing.helpTopic")} href="/help#course-pricing">
      {t("creatorEditor.builder.pricing.help")}
    </InlineHelp>
  </>;
}

describe("InlineHelp", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });

  it("opens contextual guidance in a labelled modal and restores trigger focus", () => {
    render(
      <InlineHelp topic="Course categories" href="/help#course-categories">
        Choose the subjects learners will use to find this course.
      </InlineHelp>,
    );

    const trigger = screen.getByRole("button", {
      name: "Help about Course categories",
    });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Course categories" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent(
      "Choose the subjects learners will use to find this course.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Close contextual help" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Course categories" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("localizes an already open dialog while preserving its identity, href and return focus", () => {
    render(<I18nProvider initialLocale="en"><LocalizedHelp /></I18nProvider>);
    const trigger = screen.getByRole("button", { name: "Help about Course pricing" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Course pricing" });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("dialog", { name: "Precios del curso" })).toBe(dialog);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("Ayuda contextual")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir la ayuda relacionada" })).toHaveAttribute("href", "/help#course-pricing");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar la ayuda contextual" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ayuda sobre Precios del curso" })).toBe(trigger);
    expect(trigger).toHaveFocus();
  });
});
