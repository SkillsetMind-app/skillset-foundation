import { render, screen } from "@testing-library/react";
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
