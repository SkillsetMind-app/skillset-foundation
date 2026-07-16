import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadUserStorefrontImage } from "@/lib/data/profile-media";

const mocks = vi.hoisted(() => ({
  getPublicUrl: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    storage: { from: mocks.storageFrom },
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
    mocks.storageFrom.mockReset();
    mocks.storageFrom.mockReturnValue({
      upload: mocks.upload,
      getPublicUrl: mocks.getPublicUrl,
    });
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
});
