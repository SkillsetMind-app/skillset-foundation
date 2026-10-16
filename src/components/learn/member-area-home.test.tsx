import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { MemberAreaHomeView } from "@/components/learn/member-area-home";
import type { MemberAreaHome } from "@/lib/data/member-areas";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  // Estável como o do Next: o efeito depende dele.
  return { getMemberAreaHome: vi.fn(), replace, router: { replace, refresh: () => undefined } };
});

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
// A casca real traz ajuda, conta e sino; aqui só importa o tema que ela recebe.
vi.mock("@/components/learn/member-area-shell", () => ({
  MemberAreaShell: ({ theme = "light", children }: { theme?: string; children: ReactNode }) => (
    <div data-testid="shell" data-members-theme={theme}>{children}</div>
  ),
}));
vi.mock("@/lib/data/member-areas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/member-areas")>()),
  getMemberAreaHome: mocks.getMemberAreaHome,
  memberAreaCoverUrl: (path: string) => `https://media.test/${path}`,
}));

const home: MemberAreaHome = {
  area: {
    ownerId: "u-1", username: "eton", creatorName: "Eton Simon", creatorPhotoUrl: null,
    name: "Eton Academy", theme: "dark", coverPath: "users/u-1/member-area/cover-1",
    welcomeText: "Welcome to the academy.", configured: true, isOwnerPreview: false,
  },
  continueWatching: {
    courseId: "c-a", courseTitle: "Emotional Intelligence Mastery", lessonId: "l-2",
    lessonTitle: "Naming emotions", positionSeconds: 95, lastSeenAt: null,
  },
  myProducts: [{
    courseId: "c-a", title: "Emotional Intelligence Mastery", coverImageUrl: null, productFormat: "course",
    lessonCount: 17, progressPercent: 12, enrollmentStatus: "active",
  }],
  moreProducts: [{
    courseId: "c-b", title: "Leadership Blind Spots", coverImageUrl: null, priceAmountMinor: 9700,
    currency: "usd", paymentType: "one_time", salesKey: "leadership-blind-spots",
  }],
};

function renderView(ref = "@eton", locale: "en" | "es" = "en") {
  return render(
    <I18nProvider initialLocale={locale}>
      <MemberAreaHomeView areaRef={ref} />
    </I18nProvider>,
  );
}

describe("MemberAreaHomeView", () => {
  beforeEach(() => {
    mocks.getMemberAreaHome.mockReset();
    mocks.replace.mockReset();
  });
  afterEach(cleanup);

  it("mostra a área no tema dela, com as três seções", async () => {
    mocks.getMemberAreaHome.mockResolvedValue(home);
    renderView();
    expect(await screen.findByRole("heading", { level: 1, name: "Eton Academy" })).toBeTruthy();
    expect(mocks.getMemberAreaHome).toHaveBeenCalledWith("@eton");
    expect(screen.getByTestId("shell").getAttribute("data-members-theme")).toBe("dark");
    expect(screen.getByText("By Eton Simon")).toBeTruthy();
    expect(screen.getByText("Welcome to the academy.")).toBeTruthy();

    const resume = screen.getByRole("link", { name: /Resume: Naming emotions/ });
    expect(resume.getAttribute("href")).toBe("/learn/courses/c-a?lesson=l-2");
    expect(resume.textContent).toContain("from 1:35");

    const mine = screen.getByRole("region", { name: "My products" });
    expect(within(mine).getByRole("link").getAttribute("href")).toBe("/learn/courses/c-a");
    expect(within(mine).getByText("12% complete")).toBeTruthy();

    const more = screen.getByRole("region", { name: "More from this creator" });
    expect(within(more).getByText("Locked")).toBeTruthy();
    expect(within(more).getByText("$97.00")).toBeTruthy();
    expect(within(more).getByRole("link", { name: "See details" }).getAttribute("href"))
      .toBe("/courses/leadership-blind-spots");
    // O produto não comprado nunca leva à sala: todo link da vitrine é página de vendas.
    for (const link of within(more).getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/courses\//);
    }
  });

  it("quem não é aluno nem dono vai para a vitrine pública", async () => {
    mocks.getMemberAreaHome.mockResolvedValue(null);
    renderView("@eton");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/@eton"));
    cleanup();
    renderView("u-1");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/instructors/u-1"));
  });

  it("estados vazios e a prévia do dono", async () => {
    mocks.getMemberAreaHome.mockResolvedValue({
      ...home,
      area: { ...home.area, isOwnerPreview: true, coverPath: null, welcomeText: null },
      continueWatching: null,
      myProducts: [],
      moreProducts: [],
    });
    renderView();
    expect(await screen.findByText(/Preview: this is what your students see/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit members area" }).getAttribute("href")).toBe("/teach/member-area");
    expect(screen.getByText("Open one of your products below to start.")).toBeTruthy();
    expect(screen.getByText("You have no products from this creator yet.")).toBeTruthy();
    expect(screen.getByText("You already have every product from this creator.")).toBeTruthy();
  });

  it("erro de leitura pede nova tentativa", async () => {
    mocks.getMemberAreaHome.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(home);
    renderView();
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("heading", { level: 1, name: "Eton Academy" })).toBeTruthy();
  });

  it("em espanhol", async () => {
    mocks.getMemberAreaHome.mockResolvedValue(home);
    renderView("@eton", "es");
    expect(await screen.findByRole("region", { name: "Más de este creador" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver detalles" })).toBeTruthy();
  });
});
