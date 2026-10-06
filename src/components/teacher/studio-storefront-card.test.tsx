import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { StudioStorefrontCard } from "@/components/teacher/studio-storefront-card";

const mocks = vi.hoisted(() => ({ publicProfile: null as { username: string | null } | null }));
vi.mock("@/lib/data/user-profiles", () => ({ getPublicProfile: async () => mocks.publicProfile }));

afterEach(() => {
  cleanup();
  mocks.publicProfile = null;
});

// O cartão da Home do estúdio mostra o endereço que o criador cola na bio.
it("shows and opens /@username when the public profile has one", async () => {
  mocks.publicProfile = { username: "ana.souza" };
  render(<StudioStorefrontCard uid="teacher-1" courses={[]} coursesLoaded />);

  expect(await screen.findByText("/@ana.souza")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open/ })).toHaveAttribute("href", "/@ana.souza");
});

// Lugar fixo do selo: o que resta depois de 3 "Not now" na oferta.
it.each([
  ["none", "link", "Add the verified-professional badge (free)"],
  ["rejected", "link", "Add the verified-professional badge (free)"],
  ["needs_changes", "link", "Edit application"],
  ["pending", "text", "Your badge request is in review."],
  ["approved", "text", "Your profile shows the verified-professional badge."],
])("badge slot for %s", async (status, kind, copy) => {
  render(<StudioStorefrontCard uid="teacher-1" courses={[]} coursesLoaded verificationStatus={status} />);

  if (kind === "link") {
    expect(screen.getByRole("link", { name: copy })).toHaveAttribute("href", "/teach/verification");
  } else {
    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /badge/ })).toBeNull();
  }
  await screen.findByText("/instructors/teacher-1");
});

it("no badge slot until the status loads", async () => {
  const { container } = render(<StudioStorefrontCard uid="teacher-1" courses={[]} coursesLoaded />);
  expect(container.querySelector("[data-verified-badge-slot]")).toBeNull();
  await screen.findByText("/instructors/teacher-1");
});

it("falls back to /instructors/{uid} without a username", async () => {
  render(<StudioStorefrontCard uid="teacher-1" courses={[]} coursesLoaded />);

  expect(await screen.findByText("/instructors/teacher-1")).toBeInTheDocument();
});
