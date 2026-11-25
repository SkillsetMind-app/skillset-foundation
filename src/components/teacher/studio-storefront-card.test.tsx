import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { StudioStorefrontCard } from "@/components/teacher/studio-storefront-card";

const mocks = vi.hoisted(() => ({ publicProfile: null as { username: string | null } | null }));
vi.mock("@/lib/data/user-profiles", () => ({ getPublicProfile: async () => mocks.publicProfile }));

afterEach(() => {
  cleanup();
  mocks.publicProfile = null;
});

// The Studio Home card shows the address the creator pastes in their bio.
it("shows and opens /@username when the public profile has one", async () => {
  mocks.publicProfile = { username: "ana.souza" };
  render(<StudioStorefrontCard uid="teacher-1" courses={[]} coursesLoaded />);

  expect(await screen.findByText("/@ana.souza")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open/ })).toHaveAttribute("href", "/@ana.souza");
});

// Fixed spot for the badge: what is left after 3 "Not now" on the offer. Only for
// those who can ask (none/rejected); unknown status (null) shows nothing.
it.each(["none", "rejected"])("badge slot for %s links to the request", async (status) => {
  render(<StudioStorefrontCard uid="teacher-1" courses={[]} coursesLoaded verificationStatus={status} />);

  expect(screen.getByRole("link", { name: "Add the verified-professional badge (free)" }))
    .toHaveAttribute("href", "/teach/verification");
  await screen.findByText("/instructors/teacher-1");
});

it.each(["pending", "needs_changes", "approved", null, undefined])("no badge slot for %s", async (status) => {
  const { container } = render(
    <StudioStorefrontCard uid="teacher-1" courses={[]} coursesLoaded verificationStatus={status} />,
  );
  expect(container.querySelector("[data-verified-badge-slot]")).toBeNull();
  await screen.findByText("/instructors/teacher-1");
});

it("falls back to /instructors/{uid} without a username", async () => {
  render(<StudioStorefrontCard uid="teacher-1" courses={[]} coursesLoaded />);

  expect(await screen.findByText("/instructors/teacher-1")).toBeInTheDocument();
});
