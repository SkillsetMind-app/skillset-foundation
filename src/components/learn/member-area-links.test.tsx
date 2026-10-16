import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { MemberAreaBackLink, MemberAreaLinks } from "@/components/learn/member-area-links";
import type { Enrollment } from "@/domain/enrollment";
import type { TeacherCourse } from "@/domain/teacher-course";

const mocks = vi.hoisted(() => ({ subscribeToPublicProfile: vi.fn(), getPublicProfilesByIds: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToPublicProfile: mocks.subscribeToPublicProfile,
  getPublicProfilesByIds: mocks.getPublicProfilesByIds,
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
  });
  afterEach(cleanup);

  it("um atalho por criador de quem a pessoa é aluna; reembolso não conta", async () => {
    mocks.getPublicProfilesByIds.mockResolvedValue([profile("u-1", "Eton Simon", "eton")]);
    render(withLocale(
      <MemberAreaLinks
        courses={[course("c-a", "u-1"), course("c-b", "u-1"), course("c-x", "u-2")]}
        enrollments={[enrollment("c-a", "active"), enrollment("c-b", "completed"), enrollment("c-x", "refunded")]}
      />,
    ));
    const link = await screen.findByRole("link", { name: "Open Eton Simon's members area" });
    expect(link.getAttribute("href")).toBe("/learn/areas/@eton");
    expect(mocks.getPublicProfilesByIds).toHaveBeenCalledWith(["u-1"]);
  });

  it("sem matrícula válida, nada é pedido nem mostrado", () => {
    render(withLocale(<MemberAreaLinks courses={[course("c-x", "u-2")]} enrollments={[enrollment("c-x", "refunded")]} />));
    expect(mocks.getPublicProfilesByIds).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("MemberAreaBackLink", () => {
  afterEach(cleanup);

  it("volta para a área do criador, pelo uid quando não há @", async () => {
    mocks.subscribeToPublicProfile.mockImplementation((_uid: string, next: (value: unknown) => void) => {
      next(profile("u-1", "Eton Simon", null));
      return () => undefined;
    });
    render(withLocale(<MemberAreaBackLink ownerId="u-1" />));
    const link = await screen.findByRole("link", { name: "← Eton Simon's members area" });
    expect(link.getAttribute("href")).toBe("/learn/areas/u-1");
  });

  it("sem perfil público não aparece", async () => {
    mocks.subscribeToPublicProfile.mockImplementation((_uid: string, next: (value: unknown) => void) => {
      next(null);
      return () => undefined;
    });
    render(withLocale(<MemberAreaBackLink ownerId="u-9" />));
    await waitFor(() => expect(mocks.subscribeToPublicProfile).toHaveBeenCalledWith("u-9", expect.any(Function), expect.any(Function)));
    expect(screen.queryByRole("link")).toBeNull();
  });
});
