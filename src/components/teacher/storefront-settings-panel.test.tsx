import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StorefrontSettingsPanel } from "@/components/teacher/storefront-settings-panel";

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  removeUserStorefrontImage: vi.fn(),
  subscribeToTeacherCourses: vi.fn(),
  updateUserStorefront: vi.fn(),
  uploadUserStorefrontImage: vi.fn(),
  user: { uid: "teacher-1" },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: mocks.subscribeToTeacherCourses,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  updateUserStorefront: mocks.updateUserStorefront,
}));

vi.mock("@/lib/data/profile-media", () => ({
  allowedAvatarTypes: ["image/jpeg", "image/png", "image/webp"],
  isAllowedAvatarFile: (file: File) =>
    ["image/jpeg", "image/png", "image/webp"].includes(file.type) &&
    file.size <= 5 * 1024 * 1024,
  storefrontImageRequirementLabel: "JPG, PNG, or WebP under 5 MB",
  removeUserStorefrontImage: mocks.removeUserStorefrontImage,
  uploadUserStorefrontImage: mocks.uploadUserStorefrontImage,
}));

describe("StorefrontSettingsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.getUserProfile.mockReset();
    mocks.getUserProfile.mockResolvedValue({
      displayName: "Dr. Ana Silva",
      storefront: {
        branding: { themePreset: "default" },
        showcase: { orderedCourseIds: [] },
      },
    });
    mocks.subscribeToTeacherCourses.mockReset();
    mocks.subscribeToTeacherCourses.mockImplementation(
      (_uid: string, onData: (courses: unknown[]) => void) => {
        onData([]);
        return vi.fn();
      },
    );
    mocks.updateUserStorefront.mockReset();
    mocks.updateUserStorefront.mockResolvedValue(undefined);
    mocks.removeUserStorefrontImage.mockReset();
    mocks.removeUserStorefrontImage.mockResolvedValue(undefined);
    mocks.uploadUserStorefrontImage.mockReset();
  });

  it("uses native file controls instead of asking teachers for image URLs", async () => {
    render(<StorefrontSettingsPanel />);

    expect(await screen.findByLabelText("Upload storefront logo")).toHaveAttribute(
      "type",
      "file",
    );
    expect(screen.getByLabelText("Upload storefront hero image")).toHaveAttribute(
      "type",
      "file",
    );
    expect(screen.queryByLabelText(/Logo URL/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Hero image URL/i)).not.toBeInTheDocument();
  });

  it("uploads selected media and saves only the generated public URLs", async () => {
    mocks.uploadUserStorefrontImage
      .mockResolvedValueOnce("https://media.example/storefront-logo.png?v=1")
      .mockResolvedValueOnce("https://media.example/storefront-hero.png?v=1");

    render(<StorefrontSettingsPanel />);

    const logoInput = await screen.findByLabelText("Upload storefront logo");
    const heroInput = screen.getByLabelText("Upload storefront hero image");
    const logo = new File(["logo"], "logo.png", { type: "image/png" });
    const hero = new File(["hero"], "hero.webp", { type: "image/webp" });

    fireEvent.change(logoInput, { target: { files: [logo] } });
    fireEvent.change(heroInput, { target: { files: [hero] } });

    await waitFor(() => {
      expect(mocks.uploadUserStorefrontImage).toHaveBeenNthCalledWith(
        1,
        "teacher-1",
        "logo",
        logo,
        expect.any(Function),
      );
      expect(mocks.uploadUserStorefrontImage).toHaveBeenNthCalledWith(
        2,
        "teacher-1",
        "hero",
        hero,
        expect.any(Function),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Save storefront" }));

    await waitFor(() => {
      expect(mocks.updateUserStorefront).toHaveBeenCalledWith(
        "teacher-1",
        expect.objectContaining({
          branding: expect.objectContaining({
            logoUrl: "https://media.example/storefront-logo.png?v=1",
            heroImageUrl: "https://media.example/storefront-hero.png?v=1",
          }),
        }),
      );
    });
  });

  it("keeps Save disabled until every concurrent image upload finishes", async () => {
    let resolveLogo: (value: string) => void = () => undefined;
    let resolveHero: (value: string) => void = () => undefined;
    const logoUpload = new Promise<string>((resolve) => {
      resolveLogo = resolve;
    });
    const heroUpload = new Promise<string>((resolve) => {
      resolveHero = resolve;
    });

    mocks.uploadUserStorefrontImage.mockImplementation(
      (_uid: string, kind: "logo" | "hero") =>
        kind === "logo" ? logoUpload : heroUpload,
    );

    render(<StorefrontSettingsPanel />);

    const logoInput = await screen.findByLabelText("Upload storefront logo");
    const heroInput = screen.getByLabelText("Upload storefront hero image");
    const saveButton = screen.getByRole("button", { name: "Save storefront" });

    fireEvent.change(logoInput, {
      target: { files: [new File(["logo"], "logo.png", { type: "image/png" })] },
    });
    fireEvent.change(heroInput, {
      target: { files: [new File(["hero"], "hero.webp", { type: "image/webp" })] },
    });

    expect(saveButton).toBeDisabled();

    await act(async () => {
      resolveLogo("https://media.example/storefront-logo.png?v=1");
      await logoUpload;
    });
    expect(saveButton).toBeDisabled();

    await act(async () => {
      resolveHero("https://media.example/storefront-hero.png?v=1");
      await heroUpload;
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
  });

  it("removes an uploaded object only after its saved URL is cleared", async () => {
    mocks.getUserProfile.mockResolvedValueOnce({
      displayName: "Dr. Ana Silva",
      storefront: {
        branding: {
          logoUrl: "https://media.example/storefront-logo.png?v=1",
          themePreset: "default",
        },
        showcase: { orderedCourseIds: [] },
      },
    });

    render(<StorefrontSettingsPanel />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Remove storefront logo",
    }));
    expect(mocks.removeUserStorefrontImage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save storefront" }));

    await waitFor(() => {
      expect(mocks.updateUserStorefront).toHaveBeenCalledWith(
        "teacher-1",
        expect.objectContaining({
          branding: expect.objectContaining({ logoUrl: null }),
        }),
      );
      expect(mocks.removeUserStorefrontImage).toHaveBeenCalledWith(
        "teacher-1",
        "logo",
      );
    });
    expect(
      mocks.updateUserStorefront.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.removeUserStorefrontImage.mock.invocationCallOrder[0]);
  });

  it("keeps the saved configuration and reports a retryable cleanup failure", async () => {
    mocks.getUserProfile.mockResolvedValueOnce({
      displayName: "Dr. Ana Silva",
      storefront: {
        branding: {
          heroImageUrl: "https://media.example/storefront-hero.png?v=1",
          themePreset: "default",
        },
        showcase: { orderedCourseIds: [] },
      },
    });
    mocks.removeUserStorefrontImage.mockRejectedValueOnce(
      new Error("remove failed"),
    );

    render(<StorefrontSettingsPanel />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Remove storefront hero image",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Save storefront" }));

    expect(await screen.findByText("Storefront saved.")).toBeInTheDocument();
    expect(
      screen.getByText(/old image could not be removed/i),
    ).toBeInTheDocument();
  });
});
