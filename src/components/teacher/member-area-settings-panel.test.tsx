import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { clickConfirm, stubDialogs } from "@/components/teacher/confirm-test-helpers";
import { MemberAreaSettingsPanel } from "@/components/teacher/member-area-settings-panel";

const mocks = vi.hoisted(() => ({
  createMyMemberArea: vi.fn(),
  deleteMyMemberArea: vi.fn(),
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
    deleteMyMemberArea: mocks.deleteMyMemberArea,
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

  it("virtual area: shows the defaults and lists from newest to oldest, with the draft marked", async () => {
    renderPanel();
    expect(await screen.findByText(/You have not customized it yet/)).toBeTruthy();
    expect(titles()[0]).toContain("Draft course");
    expect(titles()[0]).toContain("Not published");
    expect(titles()[1]).toContain("New course");
    expect(titles()[2]).toContain("Old course");
    expect(screen.getByPlaceholderText("Eton Simon")).toBeTruthy();
    expect(screen.getByRole("link", { name: /View as student/ }).getAttribute("href")).toBe("/learn/areas/@eton");
  });

  it("saves name, theme, welcome, the arranged order and what stayed hidden", async () => {
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
    const saved = await screen.findByText(/Saved\. Students see the changes/);
    // F-05: the "saved" stays in the buttons row, after Save, and is announced.
    expect(saved).toHaveAttribute("role", "status");
    const save = screen.getByRole("button", { name: "Save members area" });
    expect(saved.parentElement).toBe(save.parentElement);
    expect(save.compareDocumentPosition(saved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("loads what was already saved: order, hidden and cover; replacing the cover deletes the old one on save", async () => {
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
    // The old cover only goes away after the database saves the new one.
    expect(mocks.removeMemberAreaCover).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save members area" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save members area" }));
    await waitFor(() => expect(mocks.removeMemberAreaCover).toHaveBeenCalledWith("users/teacher-1/member-area/cover-1"));
    expect(mocks.saveMyMemberArea).toHaveBeenCalledWith(expect.objectContaining({ coverPath: "users/teacher-1/member-area/cover-2" }), "area-main");
  });

  // B-05 + F-12: the cover label does not become "Uploading..."; the progress is the
  // upload note, and the dimmed Save says why. The failure shows in the house notice.
  it("uploading the cover: fixed label, upload note and Save says why it is waiting", async () => {
    let finish!: (path: string) => void;
    mocks.uploadMemberAreaCover.mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }))
      .mockRejectedValueOnce(new Error("offline"));
    renderPanel();
    await screen.findByRole("list");
    fireEvent.change(screen.getByLabelText("Upload cover"), { target: { files: [new File(["x"], "capa.png", { type: "image/png" })] } });
    expect(await screen.findByText("Sending...")).toBeTruthy();
    expect(screen.queryByText("Uploading...")).toBeNull();
    const save = screen.getByRole("button", { name: "Save members area" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Wait for the cover to finish uploading, then save.");
    await act(async () => finish("users/teacher-1/member-area/cover-9"));
    expect(screen.getByRole("button", { name: "Save members area" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save members area" })).not.toHaveAccessibleDescription();

    fireEvent.change(screen.getByLabelText("Replace cover"), { target: { files: [new File(["x"], "capa.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not upload this image.");
  });

  it("an image in the wrong format does not upload", async () => {
    renderPanel();
    await screen.findByRole("list");
    fireEvent.change(screen.getByLabelText("Upload cover"), {
      target: { files: [new File(["x"], "capa.gif", { type: "image/gif" })] },
    });
    expect(await screen.findByText(/Use a JPG, PNG or WebP image under 5 MB/)).toBeTruthy();
    expect(mocks.uploadMemberAreaCover).not.toHaveBeenCalled();
  });

  // B-05: the cover uses the single image shell; accept and the 5 MB cap follow from here.
  it("cover: same accept, and an image over 5 MB does not upload", async () => {
    renderPanel();
    await screen.findByRole("list");
    const input = screen.getByLabelText("Upload cover");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    const big = new File(["x"], "capa.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect((await screen.findByText(/Use a JPG, PNG or WebP image under 5 MB/)).closest('[role="alert"]')).not.toBeNull();
    expect(mocks.uploadMemberAreaCover).not.toHaveBeenCalled();
  });

  it("a save error shows and nothing disappears", async () => {
    mocks.saveMyMemberArea.mockRejectedValue(new Error("MEMBER_AREA_FORBIDDEN"));
    renderPanel();
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: "Save members area" }));
    expect(await screen.findByText(/We could not save your members area/)).toBeTruthy();
    expect(mocks.saveMyMemberAreaProducts).not.toHaveBeenCalled();
  });

  it("a list that fails after the area is saved says what was saved and what is missing", async () => {
    mocks.saveMyMemberAreaProducts.mockRejectedValue(new Error("MEMBER_AREA_COURSE_NOT_OWNED"));
    renderPanel();
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: "Save members area" }));
    expect(await screen.findByText(/were saved, but the product order was not/)).toBeTruthy();
    expect(screen.queryByText(/You have not customized it yet/)).toBeNull();
  });

  it("a product with no title gets a fallback name", async () => {
    mocks.subscribeToTeacherCourses.mockImplementation((_uid: string, callback: (value: unknown) => void) => {
      callback([{ id: "x", title: "  ", status: "published", createdAt: "2026-10-01T00:00:00Z" }]);
      return () => undefined;
    });
    renderPanel();
    expect(await screen.findByRole("checkbox", { name: /Visible: Untitled product/ })).toBeTruthy();
  });

  it("more than 500 products: saves the order of the first 500 and warns", async () => {
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

  // Community of the whole area: only the teacher's community products go in the list.
  it("picks the area's community among the community products and saves", async () => {
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

  it("Starter: only the main one, with no new area button", async () => {
    mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton", currentPlanId: "starter" });
    renderPanel();
    expect(await screen.findByText(/Your plan includes 1 area\. Pro includes up to 3/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New area" })).toBeNull();
    expect(screen.getByText("1 of 1 areas on your plan.")).toBeTruthy();
  });

  it("Pro: creates an extra area and opens it", async () => {
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

  it("an invalid address never reaches the database", async () => {
    mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton", currentPlanId: "pro" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "New area" }));
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "community" } });
    fireEvent.click(screen.getByRole("button", { name: "Create area" }));
    expect(await screen.findByText(/"community" is reserved/)).toBeTruthy();
    expect(mocks.createMyMemberArea).not.toHaveBeenCalled();
  });

  it("extra: lists only its own products, brings one from the main one and returns another", async () => {
    mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton", currentPlanId: "pro" });
    mocks.getMyMemberAreas.mockResolvedValue(editorOf([virtualMain, {
      id: "area-2", slug: "vip", settings: { name: "VIP", theme: "light", coverPath: null, welcomeText: null }, communityCourseId: null,
    }], [["old", { areaId: "area-2", position: 0, visible: true }]]));
    renderPanel();
    await screen.findByRole("list");
    // Main: everything except what is in the VIP one.
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

  it("plan dropped: the extra is locked, it can only be deleted", async () => {
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

  // B-10: deleting was a double click on the same outlined button. Now the
  // platform dialog says the area name and only confirming deletes, with the
  // same call as before.
  it("deleting the extra asks in the dialog, with the area name, and only deletes on confirm", async () => {
    const restoreDialogs = stubDialogs();
    try {
      mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton", currentPlanId: "starter" });
      mocks.getMyMemberAreas.mockResolvedValue(editorOf([virtualMain, {
        id: "area-2", slug: "vip", settings: { name: "VIP", theme: "light", coverPath: null, welcomeText: null }, communityCourseId: null,
      }]));
      mocks.deleteMyMemberArea.mockResolvedValue(undefined);
      renderPanel();
      fireEvent.click(await screen.findByRole("tab", { name: "VIP" }));
      const trigger = screen.getByRole("button", { name: "Delete area" });
      expect(trigger).toHaveClass("button-danger");

      fireEvent.click(trigger);
      const asking = screen.getByRole("dialog", { name: "Delete this area?" });
      expect(asking).toHaveAccessibleDescription('Delete the area "VIP"? Its products go back to the main area. Nobody loses access.');
      fireEvent.click(within(asking).getByRole("button", { name: "Keep area" }));
      expect(screen.queryByRole("dialog", { name: "Delete this area?" })).toBeNull();
      expect(mocks.deleteMyMemberArea).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Delete area" }));
      clickConfirm(screen.getByRole("dialog", { name: "Delete this area?" }), "Yes, delete this area");
      await waitFor(() => expect(mocks.deleteMyMemberArea).toHaveBeenCalledExactlyOnceWith("area-2"));
    } finally {
      restoreDialogs();
    }
  });

  it("a product list that does not load gets \"Try again\", which reads again only once", async () => {
    const reload = vi.fn();
    mocks.subscribeToTeacherCourses.mockImplementation(
      (_uid: string, callback: (value: unknown) => void, onError: (error: Error) => void) => {
        onError(new Error("offline"));
        reload.mockImplementation(async () => callback(courses));
        return Object.assign(() => undefined, { reload });
      },
    );
    renderPanel();
    expect(await screen.findByText(/We could not load your products\./)).toBeTruthy();
    expect(screen.queryByText(/Reload the page/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save members area" })).toBeDisabled();
    const retry = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(await screen.findByRole("list")).toBeTruthy();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(titles()[0]).toContain("Draft course");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("in an area locked by the plan, the list's \"Try again\" stays clickable", async () => {
    // Free plan: the extra goes over the limit and its form is locked.
    mocks.getUserProfile.mockResolvedValue({ displayName: "Eton Simon", username: "eton", currentPlanId: "free" });
    mocks.getMyMemberAreas.mockResolvedValue(editorOf([virtualMain, {
      id: "area-2", slug: "vip", settings: { name: "VIP", theme: "light", coverPath: null, welcomeText: null }, communityCourseId: null,
    }]));
    const reload = vi.fn();
    mocks.subscribeToTeacherCourses.mockImplementation(
      (_uid: string, callback: (value: unknown) => void, onError: (error: Error) => void) => {
        onError(new Error("offline"));
        reload.mockImplementation(async () => callback(courses));
        return Object.assign(() => undefined, { reload });
      },
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("tab", { name: "VIP" }));
    expect(await screen.findByText(/your current plan does not include it/)).toBeTruthy();
    expect(screen.getByLabelText("Area name")).toBeDisabled();
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    // What edits the list (and the community) stays locked in the locked area.
    await screen.findByText("No products in this area yet. Add one below.");
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThan(1);
    for (const select of selects) expect(select).toBeDisabled();
  });

  it("a save error does not get \"Try again\"", async () => {
    mocks.saveMyMemberArea.mockRejectedValue(new Error("boom"));
    renderPanel();
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: "Save members area" }));
    expect(await screen.findByText("We could not save your members area. Please try again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("in Spanish", async () => {
    renderPanel("es");
    expect(await screen.findByText(/Todavía no la personalizaste/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar área de miembros" })).toBeTruthy();
  });
});
