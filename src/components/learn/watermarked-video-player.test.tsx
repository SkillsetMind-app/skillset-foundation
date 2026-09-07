import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VideoWatermark } from "@/components/learn/watermarked-video-player";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";

const mocks = vi.hoisted(() => ({
  auth: { user: { email: "student@example.com" } as { email: string } | null },
  router: { refresh: vi.fn() },
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

describe("VideoWatermark", () => {
  beforeEach(() => { mocks.auth.user = { email: "student@example.com" }; });

  it("translates the fallback and timestamp without remounting the player or restarting watermark timers", () => {
    vi.useFakeTimers();
    const instant = new Date("2026-09-06T10:12:00Z");
    vi.setSystemTime(instant);
    mocks.auth.user = null;
    const view = render(
      <I18nProvider initialLocale="en">
        <ChangeLanguage />
        <VideoWatermark brandName="Ateliê $&"><video aria-label="Aula íntegra" /></VideoWatermark>
      </I18nProvider>,
    );
    try {
      const player = screen.getByLabelText("Aula íntegra");
      const label = view.container.querySelector("[data-watermark-corner]")!;
      expect(label).toHaveTextContent("Ateliê $& learner");
      expect(vi.getTimerCount()).toBe(2);
      act(() => { vi.advanceTimersByTime(15_000); });
      fireEvent.click(screen.getByRole("button", { name: "Change language" }));
      expect(label).toHaveTextContent("Estudiante de Ateliê $&");
      expect(label).toHaveTextContent(new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(instant));
      expect(screen.getByLabelText("Aula íntegra")).toBe(player);
      expect(vi.getTimerCount()).toBe(2);
      act(() => { vi.advanceTimersByTime(15_000); });
      expect(label).toHaveAttribute("data-watermark-corner", "1");
      act(() => { vi.advanceTimersByTime(30_000); });
      expect(label).toHaveTextContent(new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(instant.getTime() + 60_000)));
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("stamps the viewer over whatever player it wraps", () => {
    render(
      <VideoWatermark>
        <iframe title="Lesson 1" src="https://www.youtube-nocookie.com/embed/abc" />
      </VideoWatermark>,
    );

    expect(screen.getByTitle("Lesson 1")).toBeInTheDocument();
    expect(
      screen.getByText(/student@example\.com/),
    ).toBeInTheDocument();
  });

  it("uma etiqueta so, pequena, que muda de canto a cada ~30 s", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <VideoWatermark>
          <video aria-label="clip" />
        </VideoWatermark>,
      );

      // Antes eram duas etiquetas fixas o tempo todo (e-mail/hora em cima,
      // "protected playback" embaixo). Agora e uma, com tudo dentro.
      const labels = container.querySelectorAll("[data-watermark-corner]");
      expect(labels).toHaveLength(1);
      expect(labels[0].textContent).toMatch(/student@example\.com/);
      expect(labels[0].textContent).toMatch(/SkillsetMind/);
      const before = labels[0].getAttribute("data-watermark-corner");

      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      const after = container
        .querySelector("[data-watermark-corner]")
        ?.getAttribute("data-watermark-corner");
      expect(after).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never intercepts clicks meant for the player controls", () => {
    const { container } = render(
      <VideoWatermark>
        <video aria-label="clip" />
      </VideoWatermark>,
    );

    // The overlay sits on top of the player; without pointer-events-none it
    // would swallow every play/pause click, including inside an iframe.
    const overlay = container.querySelector(".absolute.inset-0");
    expect(overlay?.className).toContain("pointer-events-none");
  });
});
