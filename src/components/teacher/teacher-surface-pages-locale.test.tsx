import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import MediaPage from "@/app/teach/media/page";
import MembersPage from "@/app/teach/members/page";
import CommunityPage from "@/app/teach/courses/[courseId]/community/page";

const state = vi.hoisted(() => ({ locale: "es", suspend: false }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === "skillset.locale.v1" ? { value: state.locale } : undefined }),
}));
vi.mock("@/components/auth/protected-surface", () => ({
  ProtectedSurface: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/platform/platform-shell", () => ({
  PlatformShell: ({ title, hideHeader, children }: { title: string; hideHeader: boolean; children: ReactNode }) =>
    <section aria-label={title} data-header-hidden={String(hideHeader)}>{children}</section>,
}));
vi.mock("@/components/teacher/teacher-media-library", () => ({ TeacherMediaLibrary: () => null }));
vi.mock("@/components/teacher/teacher-members-area-hub", () => ({ TeacherMembersAreaHub: () => null }));
vi.mock("@/components/teacher/teacher-community-inbox", () => ({
  TeacherCommunityInbox: ({ courseId }: { courseId: string }) => {
    if (state.suspend) throw new Promise(() => {});
    return <output>{courseId}</output>;
  },
}));
afterEach(() => { cleanup(); state.suspend = false; });

describe("teacher wrapper titles and Suspense use the real server dictionaries", () => {
  it.each([
    ["en", "Media library", "Members areas", "Community", "Loading community..."],
    ["es", "Biblioteca de archivos", "Áreas de miembros", "Comunidad", "Cargando comunidad..."],
  ])("uses cookie locale %s without changing course IDs or hidden headers", async (locale, media, members, community, loading) => {
    state.locale = locale;
    const first = render(await MediaPage());
    expect(screen.getByRole("region", { name: media })).toHaveAttribute("data-header-hidden", "true");
    first.unmount();
    const second = render(await MembersPage());
    expect(screen.getByRole("region", { name: members })).toHaveAttribute("data-header-hidden", "true");
    second.unmount();
    const params = Promise.resolve({ courseId: "original/$&" });
    const third = render(await CommunityPage({ params }));
    expect(screen.getByRole("region", { name: community })).toHaveAttribute("data-header-hidden", "true");
    expect(screen.getByRole("status")).toHaveTextContent("original/$&");
    third.unmount();
    state.suspend = true;
    render(await CommunityPage({ params }));
    expect(screen.getByText(loading)).toBeInTheDocument();
  });
});
