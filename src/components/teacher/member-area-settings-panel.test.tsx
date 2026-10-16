import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { MemberAreaSettingsPanel } from "@/components/teacher/member-area-settings-panel";

const mocks = vi.hoisted(() => ({
  getMyMemberAreaEditor: vi.fn(),
  getUserProfile: vi.fn(),
  removeMemberAreaCover: vi.fn(),
  saveMyMemberArea: vi.fn(),
  saveMyMemberAreaProducts: vi.fn(),
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
    getMyMemberAreaEditor: mocks.getMyMemberAreaEditor,
    memberAreaCoverUrl: (path: string) => `https://media.test/${path}`,
    removeMemberAreaCover: mocks.removeMemberAreaCover,
    saveMyMemberArea: mocks.saveMyMemberArea,
    saveMyMemberAreaProducts: mocks.saveMyMemberAreaProducts,
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

const titles = () => within(screen.getByRole("list")).getAllByRole("listitem").map((item) => item.textContent ?? "");

describe("MemberAreaSettingsPanel", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) if (typeof mock === "function") mock.mockReset();
    mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton" });
    mocks.getMyMemberAreaEditor.mockResolvedValue({ settings: null, choices: new Map() });
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
    });
    expect(mocks.saveMyMemberAreaProducts).toHaveBeenCalledWith([
      { courseId: "draft", visible: false },
      { courseId: "old", visible: true },
      { courseId: "new", visible: true },
    ]);
    expect(await screen.findByText(/Saved\. Students see the changes/)).toBeTruthy();
  });

  it("carrega o que já foi salvo: ordem, oculto e capa; trocar a capa apaga a antiga ao salvar", async () => {
    mocks.getMyMemberAreaEditor.mockResolvedValue({
      settings: { name: "Eton Academy", theme: "dark", coverPath: "users/teacher-1/member-area/cover-1", welcomeText: "Hi" },
      choices: new Map([["old", { position: 0, visible: true }], ["new", { position: 1, visible: false }]]),
    });
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
    expect(mocks.saveMyMemberArea).toHaveBeenCalledWith(expect.objectContaining({ coverPath: "users/teacher-1/member-area/cover-2" }));
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

  it("em espanhol", async () => {
    renderPanel("es");
    expect(await screen.findByText(/Todavía no la personalizaste/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar área de miembros" })).toBeTruthy();
  });
});
