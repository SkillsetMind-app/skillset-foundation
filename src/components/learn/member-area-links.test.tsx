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

  // Os atalhos chegavam ~0,4 s depois do resto do /learn e empurravam "My
  // courses" 54px para baixo no celular.
  describe("atalhos da ultima visita", () => {
    const CACHE = "skillset:learn-member-area-links.v1";
    const remember = (key: string, links: unknown) => window.localStorage.setItem(CACHE, JSON.stringify({ key, links }));
    const etonLink = ["u-1/", { href: "/learn/areas/@eton", name: "Eton Simon" }];

    it("mesma lista de compras: o atalho aparece ja no primeiro desenho", () => {
      remember("c-a:u-1", [etonLink]);
      mocks.getPublicProfilesByIds.mockReturnValue(new Promise(() => undefined));
      mocks.getMemberAreaSlugs.mockReturnValue(new Promise(() => undefined));
      render(withLocale(<MemberAreaLinks courses={[course("c-a", "u-1")]} enrollments={[enrollment("c-a", "active")]} />));

      expect(screen.getByRole("link", { name: "Open Eton Simon's members area" }).getAttribute("href")).toBe("/learn/areas/@eton");
    });

    it.each([
      ["outra lista de compras", "c-z:u-9", [etonLink]],
      ["endereco fora da area de membros", "c-a:u-1", [["u-1/", { href: "https://evil.example", name: "Eton Simon" }]]],
    ])("%s: nada ate as leituras chegarem", (_label, key, links) => {
      remember(key, links);
      mocks.getPublicProfilesByIds.mockReturnValue(new Promise(() => undefined));
      mocks.getMemberAreaSlugs.mockReturnValue(new Promise(() => undefined));
      render(withLocale(<MemberAreaLinks courses={[course("c-a", "u-1")]} enrollments={[enrollment("c-a", "active")]} />));

      expect(screen.queryByRole("link")).toBeNull();
    });

    it("as leituras valem quando chegam e regravam a marca (o criador saiu: o atalho sai)", async () => {
      remember("c-a:u-1", [etonLink]);
      mocks.getPublicProfilesByIds.mockResolvedValue([]);
      render(withLocale(<MemberAreaLinks courses={[course("c-a", "u-1")]} enrollments={[enrollment("c-a", "active")]} />));

      await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
      expect(JSON.parse(window.localStorage.getItem(CACHE) ?? "{}")).toEqual({ key: "c-a:u-1", links: [] });
    });

    it("primeira visita: grava os atalhos montados", async () => {
      mocks.getPublicProfilesByIds.mockResolvedValue([profile("u-1", "Eton Simon", "eton")]);
      render(withLocale(<MemberAreaLinks courses={[course("c-a", "u-1")]} enrollments={[enrollment("c-a", "active")]} />));

      await screen.findByRole("link", { name: "Open Eton Simon's members area" });
      await waitFor(() =>
        expect(JSON.parse(window.localStorage.getItem(CACHE) ?? "{}")).toEqual({ key: "c-a:u-1", links: [etonLink] }),
      );
    });
  });

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

  it("produto de uma área extra ganha o atalho dela, com o nome dela", async () => {
    mocks.getPublicProfilesByIds.mockResolvedValue([profile("u-1", "Eton Simon", "eton")]);
    mocks.getMemberAreaSlugs.mockResolvedValue(new Map([["c-b", { slug: "vip", name: "VIP Room" }]]));
    render(withLocale(
      <MemberAreaLinks
        courses={[course("c-a", "u-1"), course("c-b", "u-1")]}
        enrollments={[enrollment("c-a", "active"), enrollment("c-b", "active")]}
      />,
    ));
    const vip = await screen.findByRole("link", { name: "Open VIP Room's members area" });
    expect(vip.getAttribute("href")).toBe("/learn/areas/@eton/vip");
    expect(screen.getByRole("link", { name: "Open Eton Simon's members area" }).getAttribute("href")).toBe("/learn/areas/@eton");
    expect(mocks.getMemberAreaSlugs).toHaveBeenCalledWith(["c-a", "c-b"]);
  });

  it("enquanto não sabe a área, não mostra atalho errado", async () => {
    mocks.getPublicProfilesByIds.mockResolvedValue([profile("u-1", "Eton Simon", "eton")]);
    mocks.getMemberAreaSlugs.mockReturnValue(new Promise(() => undefined));
    render(withLocale(<MemberAreaLinks courses={[course("c-b", "u-1")]} enrollments={[enrollment("c-b", "active")]} />));
    await waitFor(() => expect(mocks.getPublicProfilesByIds).toHaveBeenCalled());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("sem matrícula válida, nada é pedido nem mostrado", () => {
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

  it("dá o endereço da área do criador, pelo uid quando não há @", async () => {
    mocks.subscribeToPublicProfile.mockImplementation((uid: string, next: (value: unknown) => void) => {
      next(profile(uid, "Eton Simon", null));
      return () => undefined;
    });
    render(withLocale(<AreaProbe ownerId="u-1" />));
    expect(await screen.findByText("Eton Simon -> /learn/areas/u-1")).toBeTruthy();
  });

  it("da sala de um produto numa extra, volta para ela", async () => {
    mocks.subscribeToPublicProfile.mockImplementation((uid: string, next: (value: unknown) => void) => {
      next(profile(uid, "Eton Simon", "eton"));
      return () => undefined;
    });
    mocks.getMemberAreaSlugs.mockResolvedValue(new Map([["c-b", { slug: "vip", name: "VIP Room" }]]));
    render(withLocale(<AreaProbe ownerId="u-1" courseId="c-b" />));
    expect(await screen.findByText("VIP Room -> /learn/areas/@eton/vip")).toBeTruthy();
  });

  it("sem perfil público: null, e a sala volta para /learn", async () => {
    mocks.subscribeToPublicProfile.mockImplementation((_uid: string, next: (value: unknown) => void) => {
      next(null);
      return () => undefined;
    });
    render(withLocale(<AreaProbe ownerId="u-9" />));
    await waitFor(() => expect(mocks.subscribeToPublicProfile).toHaveBeenCalledWith("u-9", expect.any(Function), expect.any(Function)));
    expect(screen.getByText("sem area")).toBeTruthy();
  });
});
