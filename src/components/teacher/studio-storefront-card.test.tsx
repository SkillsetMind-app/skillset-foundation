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

it("falls back to /instructors/{uid} without a username", async () => {
  render(<StudioStorefrontCard uid="teacher-1" courses={[]} coursesLoaded />);

  expect(await screen.findByText("/instructors/teacher-1")).toBeInTheDocument();
});
