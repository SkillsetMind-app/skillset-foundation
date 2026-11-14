import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { MemberAreaSettingsPanel } from "@/components/teacher/member-area-settings-panel";

const mocks = vi.hoisted(() => ({
  createMyMemberArea: vi.fn(),
  getMyMemberAreas: vi.fn(),
  getUserProfile: vi.fn(),
  removeMemberAreaCover: vi.fn(),
  saveMyMemberArea: vi.fn(),
  saveMyMemberAreaProducts: vi.fn(),
  setMyMemberAreaCommunity: vi.fn(),
  subscribeToTeacherCourses: vi.fn(),
  uploadMemberAreaCover: vi.fn(),
  user: { uid: "teacher-1" },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/teacher-courses", () => ({ subscribeToTeacherCourses: mocks.subscribeToTeacherCourses }));
vi.mock("@/lib/data/user-profiles", () => ({ getUserProfile: mocks.getUserProfile }));
vi.mock("@/lib/data/member-areas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/member-areas")>();
  return {
    ...actual,
    createMyMemberArea: mocks.createMyMemberArea,
    getMyMemberAreas: mocks.getMyMemberAreas,
    memberAreaCoverUrl: (path: string) => `https://media.test/${path}`,
    removeMemberAreaCover: mocks.removeMemberAreaCover,
    saveMyMemberArea: mocks.saveMyMemberArea,
    saveMyMemberAreaProducts: mocks.saveMyMemberAreaProducts,
    setMyMemberAreaCommunity: mocks.setMyMemberAreaCommunity,
    uploadMemberAreaCover: mocks.uploadMemberAreaCover,
  };
});

const courses = [
  { id: "old", title: "Old course", status: "published", createdAt: "2026-01-01T00:00:00Z" },
  { id: "new", title: "New course", status: "published", createdAt: "2026-10-01T00:00:00Z" },
  { id: "draft", title: "Draft course", status: "draft", createdAt: "2026-10-10T00:00:00Z" },
];

function renderPanel(locale: "en" | "es" = "en") {
  return render(
    <I18nProvider initialLocale={locale}>
      <MemberAreaSettingsPanel />
    </I18nProvider>,
  );
}

const virtualMain = { id: null, slug: null, settings: null, communityCourseId: null };
const editorOf = (areas: unknown[], placement: [string, { areaId: string; position: number; visible: boolean }][] = []) => ({
  areas,
  placement: new Map(placement),
});

const titles = () => within(screen.getByRole("list")).getAllByRole("listitem").map((item) => item.textContent ?? "");

describe("MemberAreaSettingsPanel", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) if (typeof mock === "function") mock.mockReset();
    mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton" });
    mocks.getMyMemberAreas.mockResolvedValue(editorOf([virtualMain]));
    mocks.setMyMemberAreaCommunity.mockResolvedValue(undefined);
    mocks.subscribeToTeacherCourses.mockImplementation((_uid: string, callback: (value: unknown) => void) => {
      callback(courses);
      return () => undefined;
    });
    mocks.saveMyMemberArea.mockResolvedValue(undefined);
    mocks.saveMyMemberAreaProducts.mockResolvedValue(undefined);
    mocks.removeMemberAreaCover.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("área virtual: avisa os padrões e lista do mais novo ao mais antigo, com rascunho marcado", async () => {
    renderPanel();
    expect(await screen.findByText(/You have not customized it yet/)).toBeTruthy();
    expect(titles()[0]).toContain("Draft course");
    expect(titles()[0]).toContain("Not published");
    expect(titles()[1]).toContain("New course");
    expect(titles()[2]).toContain("Old course");
    expect(screen.getByPlaceholderText("Eton Simon")).toBeTruthy();
    expect(screen.getByRole("link", { name: /View as student/ }).getAttribute("href")).toBe("/learn/areas/@eton");
  });

  it("salva nome, tema, boas-vindas, a ordem arrumada e quem ficou oculto", async () => {
    renderPanel();
    await screen.findByRole("list");
    fireEvent.change(screen.getByLabelText("Area name"), { target: { value: "Eton Academy" } });
    fireEvent.click(screen.getByLabelText("Dark"));
    fireEvent.change(screen.getByLabelText("Welcome text"), { target: { value: "Welcome!" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Old course up" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Visible: Draft course/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save members area" }));

    await waitFor(() => expect(mocks.saveMyMemberAreaProducts).toHaveBeenCalled());
    expect(mocks.saveMyMemberArea).toHaveBeenCalledWith({
      name: "Eton Academy", theme: "dark", coverPath: null, welcomeText: "Welcome!",
    }, null);
    expect(mocks.saveMyMemberAreaProducts).toHaveBeenCalledWith([
      { courseId: "draft", visible: false },
      { courseId: "old", visible: true },
      { courseId: "new", visible: true },
    ], null);
    expect(await screen.findByText(/Saved\. Students see the changes/)).toBeTruthy();
  });

  it("carrega o que já foi salvo: ordem, oculto e capa; trocar a capa apaga a antiga ao salvar", async () => {
    mocks.getMyMemberAreas.mockResolvedValue(editorOf([{
      id: "area-main",
      slug: null,
      settings: { name: "Eton Academy", theme: "dark", coverPath: "users/teacher-1/member-area/cover-1", welcomeText: "Hi" },
      communityCourseId: null,
    }], [["old", { areaId: "area-main", position: 0, visible: true }], ["new", { areaId: "area-main", position: 1, visible: false }]]));
    mocks.uploadMemberAreaCover.mockResolvedValue("users/teacher-1/member-area/cover-2");
    renderPanel();
    await screen.findByRole("list");
    expect(screen.queryByText(/You have not customized it yet/)).toBeNull();
    expect(titles().map((text) => text.slice(1, 4))).toEqual(["Old", "New", "Dra"]);
    expect(screen.getByRole("checkbox", { name: /Visible: New course/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Visible: Old course/ })).toBeChecked();

    const file = new File(["x"], "capa.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Replace cover"), { target: { files: [file] } });
    await waitFor(() => expect(mocks.uploadMemberAreaCover).toHaveBeenCalledWith("teacher-1", file));
    // A capa velha só sai depois que o banco grava a nova.
    expect(mocks.removeMemberAreaCover).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save members area" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save members area" }));
    await waitFor(() => expect(mocks.removeMemberAreaCover).toHaveBeenCalledWith("users/teacher-1/member-area/cover-1"));
    expect(mocks.saveMyMemberArea).toHaveBeenCalledWith(expect.objectContaining({ coverPath: "users/teacher-1/member-area/cover-2" }), "area-main");
  });

  it("imagem fora do formato não sobe", async () => {
    renderPanel();
    await screen.findByRole("list");
    fireEvent.change(screen.getByLabelText("Upload cover"), {
      target: { files: [new File(["x"], "capa.gif", { type: "image/gif" })] },
    });
    expect(await screen.findByText(/Use a JPG, PNG or WebP image under 5 MB/)).toBeTruthy();
    expect(mocks.uploadMemberAreaCover).not.toHaveBeenCalled();
  });

  it("erro ao salvar aparece e nada some", async () => {
    mocks.saveMyMemberArea.mockRejectedValue(new Error("MEMBER_AREA_FORBIDDEN"));
    renderPanel();
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: "Save members area" }));
    expect(await screen.findByText(/We could not save your members area/)).toBeTruthy();
    expect(mocks.saveMyMemberAreaProducts).not.toHaveBeenCalled();
  });

  it("lista que falha depois da área salva avisa o que ficou e o que faltou", async () => {
    mocks.saveMyMemberAreaProducts.mockRejectedValue(new Error("MEMBER_AREA_COURSE_NOT_OWNED"));
    renderPanel();
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: "Save members area" }));
    expect(await screen.findByText(/were saved, but the product order was not/)).toBeTruthy();
    expect(screen.queryByText(/You have not customized it yet/)).toBeNull();
  });

  it("produto sem título ganha nome de reserva", async () => {
    mocks.subscribeToTeacherCourses.mockImplementation((_uid: string, callback: (value: unknown) => void) => {
      callback([{ id: "x", title: "  ", status: "published", createdAt: "2026-10-01T00:00:00Z" }]);
      return () => undefined;
    });
    renderPanel();
    expect(await screen.findByRole("checkbox", { name: /Visible: Untitled product/ })).toBeTruthy();
  });

  it("mais de 500 produtos: salva a ordem dos 500 primeiros e avisa", async () => {
    const many = Array.from({ length: 501 }, (_, index) => ({
      id: `c-${index}`, title: `Course ${index}`, status: "published",
      createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    }));
    mocks.subscribeToTeacherCourses.mockImplementation((_uid: string, callback: (value: unknown) => void) => {
      callback(many);
      return () => undefined;
    });
    renderPanel();
    expect(await screen.findByText(/saved for the first 500 products/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save members area" }));
    await waitFor(() => expect(mocks.saveMyMemberAreaProducts).toHaveBeenCalled());
    expect(mocks.saveMyMemberAreaProducts.mock.calls[0][0]).toHaveLength(500);
  });

  // Comunidade da área inteira: só produto community do professor entra na lista.
  it("escolhe a comunidade da área entre os produtos community e salva", async () => {
    mocks.subscribeToTeacherCourses.mockImplementation((_uid: string, callback: (value: unknown) => void) => {
      callback([
        ...courses,
        { id: "club", title: "Inner circle", status: "published", productFormat: "community", communityEnabled: true, createdAt: "2026-10-02T00:00:00Z" },
      ]);
      return () => undefined;
    });
    renderPanel();
    const select = await screen.findByRole("combobox", { name: "Community for the whole area" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["No area community", "Inner circle"]);
    expect(titles().some((title) => title.includes("Inner circle") && title.includes("Community"))).toBe(true);
    fireEvent.change(select, { target: { value: "club" } });
    fireEvent.click(screen.getByRole("button", { name: "Save members area" }));
    await waitFor(() => expect(mocks.setMyMemberAreaCommunity).toHaveBeenCalledWith("club", null));
    expect(await screen.findByText(/^Saved. Students see the changes/)).toBeTruthy();
  });

  it("Starter: só a principal, sem botão de nova área", async () => {
    mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton", currentPlanId: "starter" });
    renderPanel();
    expect(await screen.findByText(/Your plan includes 1 area\. Pro includes up to 3/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New area" })).toBeNull();
    expect(screen.getByText("1 of 1 areas on your plan.")).toBeTruthy();
  });

  it("Pro: cria uma área extra e abre nela", async () => {
    mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton", currentPlanId: "pro" });
    mocks.createMyMemberArea.mockResolvedValue("area-2");
    mocks.getMyMemberAreas
      .mockResolvedValueOnce(editorOf([virtualMain]))
      .mockResolvedValue(editorOf([virtualMain, {
        id: "area-2", slug: "vip", settings: { name: "VIP", theme: "light", coverPath: null, welcomeText: null }, communityCourseId: null,
      }]));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "New area" }));
    fireEvent.change(screen.getByLabelText("Name of the new area"), { target: { value: "VIP" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "VIP Room" } });
    expect(screen.getByText(/\/learn\/areas\/@eton\/vip-room/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "vip" } });
    fireEvent.click(screen.getByRole("button", { name: "Create area" }));
    await waitFor(() => expect(mocks.createMyMemberArea).toHaveBeenCalledWith("VIP", "vip"));
    expect(await screen.findByRole("tab", { name: "VIP", selected: true })).toBeTruthy();
    expect(screen.getByText(/No products in this area yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /View as student/ }).getAttribute("href")).toBe("/learn/areas/@eton/vip");
  });

  it("endereço inválido nem chega ao banco", async () => {
    mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton", currentPlanId: "pro" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "New area" }));
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "community" } });
    fireEvent.click(screen.getByRole("button", { name: "Create area" }));
    expect(await screen.findByText(/"community" is reserved/)).toBeTruthy();
    expect(mocks.createMyMemberArea).not.toHaveBeenCalled();
  });

  it("extra: lista só os produtos dela, traz um da principal e devolve outro", async () => {
    mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton", currentPlanId: "pro" });
    mocks.getMyMemberAreas.mockResolvedValue(editorOf([virtualMain, {
      id: "area-2", slug: "vip", settings: { name: "VIP", theme: "light", coverPath: null, welcomeText: null }, communityCourseId: null,
    }], [["old", { areaId: "area-2", position: 0, visible: true }]]));
    renderPanel();
    await screen.findByRole("list");
    // Principal: tudo menos o que está na VIP.
    expect(titles().join("|")).not.toContain("Old course");
    fireEvent.click(screen.getByRole("tab", { name: "VIP" }));
    expect(titles()).toHaveLength(1);
    expect(titles()[0]).toContain("Old course");
    fireEvent.change(screen.getByLabelText("Add a product to this area"), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Old course from this area" }));
    fireEvent.click(screen.getByRole("button", { name: "Save members area" }));
    await waitFor(() => expect(mocks.saveMyMemberAreaProducts).toHaveBeenCalledWith([{ courseId: "new", visible: true }], "area-2"));
    expect(mocks.saveMyMemberArea).toHaveBeenCalledWith(expect.objectContaining({ name: "VIP" }), "area-2");
  });

  it("plano caiu: a extra fica travada, só dá para apagar", async () => {
    mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton", currentPlanId: "starter" });
    mocks.getMyMemberAreas.mockResolvedValue(editorOf([virtualMain, {
      id: "area-2", slug: "vip", settings: { name: "VIP", theme: "light", coverPath: null, welcomeText: null }, communityCourseId: null,
    }]));
    renderPanel();
    fireEvent.click(await screen.findByRole("tab", { name: "VIP" }));
    expect(screen.getByText(/your current plan does not include it/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save members area" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete area" })).toBeEnabled();
  });

  it("em espanhol", async () => {
    renderPanel("es");
    expect(await screen.findByText(/Todavía no la personalizaste/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar área de miembros" })).toBeTruthy();
  });
});
