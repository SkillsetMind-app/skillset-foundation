import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseShareLink } from "./course-share-link";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("CourseShareLink", () => {
  it("shows and copies the permanent public URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout?offer=LAUNCH" />);
    const url = "https://www.skillsetmind.com/courses/course-1/checkout?offer=LAUNCH";
    expect(screen.getByText(url)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Checkout" })).toHaveAttribute("href", url);
    fireEvent.click(screen.getByRole("button", { name: "Copy Checkout link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied.");
    expect(writeText).toHaveBeenCalledWith(url);
  });
  it("announces denied clipboard permission and keeps the URL available", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Checkout link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Copy the link above manually.");
    expect(screen.queryByText("Link copied.")).not.toBeInTheDocument();
    expect(screen.getByText("https://www.skillsetmind.com/courses/course-1/checkout")).toBeInTheDocument();
  });
});
