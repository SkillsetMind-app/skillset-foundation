import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  uploadUserAvatar: vi.fn(),
  user: { uid: "user-1", roles: ["student"], displayName: "Ana", email: "ana@example.com" },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, refreshUser: async () => undefined }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  updateUserIdentity: vi.fn(),
}));

vi.mock("@/lib/data/profile-media", () => ({
  allowedAvatarTypes: ["image/jpeg", "image/png", "image/webp"],
  avatarRequirementLabel: "JPG, PNG, or WebP under 5 MB",
  signatureRequirementLabel: "PNG, JPG, or WebP under 5 MB",
  isAllowedAvatarFile: (file: File) =>
    ["image/jpeg", "image/png", "image/webp"].includes(file.type),
  uploadTeacherSignature: vi.fn(),
  uploadUserAvatar: mocks.uploadUserAvatar,
}));

const { ProfileSettingsPanel } = await import(
  "@/components/account/profile-settings-panel"
);

describe("ProfileSettingsPanel — progresso do avatar", () => {
  beforeEach(() => {
    mocks.getUserProfile.mockReset();
    mocks.getUserProfile.mockResolvedValue({ displayName: "Ana" });
    mocks.uploadUserAvatar.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // "Uploading 0%" o envio inteiro (o Storage não informa progresso) se lia
  // como "travou". Mesmo contrato do #138: sem número do transporte, sem
  // número na tela.
  it("não inventa porcentagem enquanto a foto sobe", async () => {
    mocks.uploadUserAvatar.mockImplementation(
      (
        _uid: string,
        file: File,
        onProgress: (progress: {
          bytesTransferred: number;
          totalBytes: number;
          percent: number | null;
          state: "running";
        }) => void,
      ) => {
        onProgress({ bytesTransferred: 0, totalBytes: file.size, percent: null, state: "running" });
        return new Promise<string>(() => undefined);
      },
    );

    render(<ProfileSettingsPanel />);

    const input = await screen.findByLabelText("Upload profile photo");
    fireEvent.change(input, {
      target: { files: [new File(["png"], "me.png", { type: "image/png" })] },
    });

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Sending...");
    expect(status).not.toHaveTextContent("%");
  });
});
