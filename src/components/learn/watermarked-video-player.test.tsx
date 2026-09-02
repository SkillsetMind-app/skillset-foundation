import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VideoWatermark } from "@/components/learn/watermarked-video-player";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { email: "student@example.com" } }),
}));

describe("VideoWatermark", () => {
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
