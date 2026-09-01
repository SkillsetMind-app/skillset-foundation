import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  removeUserStorefrontImage,
  uploadUserAvatar,
  uploadUserStorefrontImage,
  type UploadAvatarProgress,
} from "@/lib/data/profile-media";

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  getPublicUrl: vi.fn(),
  remove: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    storage: { from: mocks.storageFrom },
    from: () => ({ update: () => ({ eq: mocks.eq }) }),
  }),
}));

describe("profile media storefront uploads", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.upload.mockReset();
    mocks.upload.mockResolvedValue({ error: null });
    mocks.getPublicUrl.mockReset();
    mocks.getPublicUrl.mockReturnValue({
      data: { publicUrl: "https://project.supabase.co/storage/v1/object/public/public-media/file" },
    });
    mocks.remove.mockReset();
    mocks.remove.mockResolvedValue({ error: null });
    mocks.storageFrom.mockReset();
    mocks.storageFrom.mockReturnValue({
      upload: mocks.upload,
      getPublicUrl: mocks.getPublicUrl,
      remove: mocks.remove,
    });
    mocks.eq.mockReset();
    mocks.eq.mockResolvedValue({ error: null });
    vi.spyOn(Date, "now").mockReturnValue(1234);
  });

  it.each([
    ["logo", "users/teacher-1/storefront/logo/logo"],
    ["hero", "users/teacher-1/storefront/hero/hero"],
  ] as const)("uploads a %s to a deterministic owner-scoped path", async (kind, path) => {
    const file = new File([kind], `${kind}.png`, { type: "image/png" });

    await expect(uploadUserStorefrontImage("teacher-1", kind, file)).resolves.toBe(
      "https://project.supabase.co/storage/v1/object/public/public-media/file?v=1234",
    );

    expect(mocks.storageFrom).toHaveBeenCalledWith("public-media");
    expect(mocks.upload).toHaveBeenCalledWith(path, file, {
      contentType: "image/png",
      upsert: true,
    });
  });

  it("rejects unsupported files before touching Storage", async () => {
    const file = new File(["not an image"], "notes.txt", { type: "text/plain" });

    await expect(uploadUserStorefrontImage("teacher-1", "logo", file)).rejects.toThrow(
      "JPG, PNG, or WebP under 5 MB",
    );
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });

  it.each([
    ["logo", "users/teacher-1/storefront/logo/logo"],
    ["hero", "users/teacher-1/storefront/hero/hero"],
  ] as const)("removes the saved %s object from its deterministic path", async (kind, path) => {
    await expect(removeUserStorefrontImage("teacher-1", kind)).resolves.toBeUndefined();

    expect(mocks.storageFrom).toHaveBeenCalledWith("public-media");
    expect(mocks.remove).toHaveBeenCalledWith([path]);
  });

  it("surfaces Storage removal failures", async () => {
    mocks.remove.mockResolvedValueOnce({ error: new Error("remove failed") });

    await expect(
      removeUserStorefrontImage("teacher-1", "logo"),
    ).rejects.toThrow("remove failed");
  });
});

// Mesmo contrato dos uploads de curso (#138): o Storage não informa progresso,
// então "running" sai sem porcentagem — um 0% parado o envio inteiro se lia
// como "travou" — e "success" só sai depois da última escrita.
describe("profile media — progresso honesto", () => {
  type Seen = Pick<UploadAvatarProgress, "percent" | "state">;

  function record(events: Seen[]) {
    return (progress: UploadAvatarProgress) =>
      events.push({ percent: progress.percent, state: progress.state });
  }

  it("storefront: 'running' sem número, e 'success' com 100% só depois de o objeto subir", async () => {
    const events: Seen[] = [];
    mocks.upload.mockImplementationOnce(async () => {
      expect(events).toEqual([{ percent: null, state: "running" }]);
      return { error: null };
    });

    await uploadUserStorefrontImage(
      "teacher-1",
      "logo",
      new File(["logo"], "logo.png", { type: "image/png" }),
      record(events),
    );

    expect(events).toEqual([
      { percent: null, state: "running" },
      { percent: 100, state: "success" },
    ]);
  });

  it("avatar: sem 'success' se a gravação em users falha depois de o objeto subir", async () => {
    const events: Seen[] = [];
    mocks.eq.mockResolvedValueOnce({ error: new Error("update failed") });

    await expect(
      uploadUserAvatar(
        "user-1",
        new File(["me"], "me.png", { type: "image/png" }),
        record(events),
      ),
    ).rejects.toThrow("update failed");

    expect(events).toEqual([{ percent: null, state: "running" }]);
  });
});
