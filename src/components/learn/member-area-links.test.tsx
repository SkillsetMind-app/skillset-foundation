import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { MemberAreaLinks, useCreatorAreaLink } from "@/components/learn/member-area-links";
import type { Enrollment } from "@/domain/enrollment";
import type { TeacherCourse } from "@/domain/teacher-course";

const mocks = vi.hoisted(() => ({
  subscribeToPublicProfile: vi.fn(),
  getPublicProfilesByIds: vi.fn(),
  getMemberAreaSlugs: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToPublicProfile: mocks.subscribeToPublicProfile,
  getPublicProfilesByIds: mocks.getPublicProfilesByIds,
}));
vi.mock("@/lib/data/member-areas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/member-areas")>()),
  getMemberAreaSlugs: mocks.getMemberAreaSlugs,
}));

const profile = (uid: string, displayName: string, username: string | null) =>
  ({ uid, displayName, username, photoURL: null, bio: null, credentials: [] });

const course = (id: string, ownerId: string) => ({ id, ownerId, title: id }) as unknown as TeacherCourse;
const enrollment = (courseId: string, status: string) => ({ courseId, status }) as unknown as Enrollment;

const withLocale = (node: React.ReactNode) => <I18nProvider initialLocale="en">{node}</I18nProvider>;

describe("MemberAreaLinks", () => {
  beforeEach(() => {
    mocks.subscribeToPublicProfile.mockReset();
    mocks.getPublicProfilesByIds.mockReset();
    mocks.getMemberAreaSlugs.mockReset();
    mocks.getMemberAreaSlugs.mockResolvedValue(new Map());
    window.localStorage.clear();
  });
  afterEach(cleanup);

  // The shortcuts arrived ~0.4 s after the /learn header and pushed
  // "My courses" 54px down on the phone.
  describe("shortcuts from the last visit", () => {
    const CACHE = "skillset:learn-member-area-links.v1";
    const remember = (key: string, links: unknown) => window.localStorage.setItem(CACHE, JSON.stringify({ key, links }));
    const evanLink = ["u-1/", { href: "/learn/areas/@evan", name: "Evan Stone" }];
    const reserved = () => document.querySelector('[data-reserved="member-area-link"]');
    const saved = () => JSON.parse(window.localStorage.getItem(CACHE) ?? "null");

    it("same enrollments: holds the place before the course list, without navigating", () => {
      remember("c-a", [evanLink]);
      // The course list has not arrived yet: only the enrollments.
      render(withLocale(<MemberAreaLinks courses={[]} coursesSettled={false} enrollments={[enrollment("c-a", "active")]} />));

      expect(reserved()?.textContent).toBe("Open Evan Stone's members area");
      expect(reserved()).toHaveAttribute("aria-hidden", "true");
      expect(screen.queryByRole("link")).toBeNull();
    });

    it.each([
      ["outras matriculas", "c-z", [evanLink]],
      ["endereco fora da area de membros", "c-a", [["u-1/", { href: "https://evil.example", name: "Evan Stone" }]]],
    ])("%s: nothing stored shows up", (_label, key, links) => {
      remember(key, links);
      render(withLocale(<MemberAreaLinks courses={[]} coursesSettled={false} enrollments={[enrollment("c-a", "active")]} />));

      expect(reserved()).toBeNull();
    });

    it("the reads arrive: the real button takes its place and the memory is rewritten", async () => {
      remember("c-a", [["u-1/", { href: "/learn/areas/@old", name: "Evan Stone" }]]);
      mocks.getPublicProfilesByIds.mockResolvedValue([profile("u-1", "Evan Stone", "evan")]);
      render(withLocale(<MemberAreaLinks courses={[course("c-a", "u-1")]} enrollments={[enrollment("c-a", "active")]} />));

      const link = await screen.findByRole("link", { name: "Open Evan Stone's members area" });
      expect(link.getAttribute("href")).toBe("/learn/areas/@evan");
      expect(reserved()).toBeNull();
      await waitFor(() => expect(saved()).toEqual({ key: "c-a", links: [evanLink] }));
    });

    it("the areas read failed: shows the main one, but does not become memory", async () => {
      remember("c-b", [["u-1/vip", { href: "/learn/areas/@evan/vip", name: "VIP Room" }]]);
      mocks.getPublicProfilesByIds.mockResolvedValue([profile("u-1", "Evan Stone", "evan")]);
      mocks.getMemberAreaSlugs.mockRejectedValue(new Error("offline"));
      render(withLocale(<MemberAreaLinks courses={[course("c-b", "u-1")]} enrollments={[enrollment("c-b", "active")]} />));

      await screen.findByRole("link", { name: "Open Evan Stone's members area" });
      expect(saved()).toEqual({ key: "c-b", links: [["u-1/vip", { href: "/learn/areas/@evan/vip", name: "VIP Room" }]] });
    });

    it("the courses read came back without the course: the stored place is dropped", () => {
      remember("c-a", [evanLink]);
      render(withLocale(<MemberAreaLinks courses={[]} coursesSettled enrollments={[enrollment("c-a", "active")]} />));

      expect(reserved()).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("the creator left: the shortcut goes away and the memory becomes 'none'", async () => {
      remember("c-a", [evanLink]);
      mocks.getPublicProfilesByIds.mockResolvedValue([]);
      render(withLocale(<MemberAreaLinks courses={[course("c-a", "u-1")]} enrollments={[enrollment("c-a", "active")]} />));

      await waitFor(() => expect(saved()).toEqual({ key: "c-a", links: [] }));
      expect(reserved()).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  it("one shortcut per creator the person is a learner of; a refund does not count", async () => {
    mocks.getPublicProfilesByIds.mockResolvedValue([profile("u-1", "Evan Stone", "evan")]);
    render(withLocale(
      <MemberAreaLinks
        courses={[course("c-a", "u-1"), course("c-b", "u-1"), course("c-x", "u-2")]}
        enrollments={[enrollment("c-a", "active"), enrollment("c-b", "completed"), enrollment("c-x", "refunded")]}
      />,
    ));
    const link = await screen.findByRole("link", { name: "Open Evan Stone's members area" });
    expect(link.getAttribute("href")).toBe("/learn/areas/@evan");
    expect(mocks.getPublicProfilesByIds).toHaveBeenCalledWith(["u-1"]);
  });

  it("a product in an extra area gets its own shortcut, with its own name", async () => {
    mocks.getPublicProfilesByIds.mockResolvedValue([profile("u-1", "Evan Stone", "evan")]);
    mocks.getMemberAreaSlugs.mockResolvedValue(new Map([["c-b", { slug: "vip", name: "VIP Room" }]]));
    render(withLocale(
      <MemberAreaLinks
        courses={[course("c-a", "u-1"), course("c-b", "u-1")]}
        enrollments={[enrollment("c-a", "active"), enrollment("c-b", "active")]}
      />,
    ));
    const vip = await screen.findByRole("link", { name: "Open VIP Room's members area" });
    expect(vip.getAttribute("href")).toBe("/learn/areas/@evan/vip");
    expect(screen.getByRole("link", { name: "Open Evan Stone's members area" }).getAttribute("href")).toBe("/learn/areas/@evan");
    expect(mocks.getMemberAreaSlugs).toHaveBeenCalledWith(["c-a", "c-b"]);
  });

  it("while the area is unknown, it does not show a wrong shortcut", async () => {
    mocks.getPublicProfilesByIds.mockResolvedValue([profile("u-1", "Evan Stone", "evan")]);
    mocks.getMemberAreaSlugs.mockReturnValue(new Promise(() => undefined));
    render(withLocale(<MemberAreaLinks courses={[course("c-b", "u-1")]} enrollments={[enrollment("c-b", "active")]} />));
    await waitFor(() => expect(mocks.getPublicProfilesByIds).toHaveBeenCalled());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("without a valid enrollment, nothing is requested or shown", () => {
    render(withLocale(<MemberAreaLinks courses={[course("c-x", "u-2")]} enrollments={[enrollment("c-x", "refunded")]} />));
    expect(mocks.getPublicProfilesByIds).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

function AreaProbe({ ownerId, courseId = null }: { ownerId: string; courseId?: string | null }) {
  const area = useCreatorAreaLink(ownerId, courseId);
  return <p>{area ? `${area.name} -> ${area.href}` : "sem area"}</p>;
}

describe("useCreatorAreaLink", () => {
  afterEach(cleanup);

  it("gives the address of the creator's area, by uid when there is no @", async () => {
    mocks.subscribeToPublicProfile.mockImplementation((uid: string, next: (value: unknown) => void) => {
      next(profile(uid, "Evan Stone", null));
      return () => undefined;
    });
    render(withLocale(<AreaProbe ownerId="u-1" />));
    expect(await screen.findByText("Evan Stone -> /learn/areas/u-1")).toBeTruthy();
  });

  it("from the room of a product in an extra area, it goes back to that area", async () => {
    mocks.subscribeToPublicProfile.mockImplementation((uid: string, next: (value: unknown) => void) => {
      next(profile(uid, "Evan Stone", "evan"));
      return () => undefined;
    });
    mocks.getMemberAreaSlugs.mockResolvedValue(new Map([["c-b", { slug: "vip", name: "VIP Room" }]]));
    render(withLocale(<AreaProbe ownerId="u-1" courseId="c-b" />));
    expect(await screen.findByText("VIP Room -> /learn/areas/@evan/vip")).toBeTruthy();
  });

  it("without a public profile: null, and the room goes back to /learn", async () => {
    mocks.subscribeToPublicProfile.mockImplementation((_uid: string, next: (value: unknown) => void) => {
      next(null);
      return () => undefined;
    });
    render(withLocale(<AreaProbe ownerId="u-9" />));
    await waitFor(() => expect(mocks.subscribeToPublicProfile).toHaveBeenCalledWith("u-9", expect.any(Function), expect.any(Function)));
    expect(screen.getByText("sem area")).toBeTruthy();
  });
});
