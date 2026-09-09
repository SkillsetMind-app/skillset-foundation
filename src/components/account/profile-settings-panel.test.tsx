import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  uploadUserAvatar: vi.fn(),
  uploadTeacherSignature: vi.fn(),
  refreshUser: vi.fn(),
  user: { uid: "user-1", roles: ["student"], displayName: "Ana", email: "ana@example.com" },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, refreshUser: mocks.refreshUser }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  updateUserIdentity: vi.fn(),
}));

vi.mock("@/lib/data/profile-media", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/data/profile-media")>(),
  uploadTeacherSignature: mocks.uploadTeacherSignature,
  uploadUserAvatar: mocks.uploadUserAvatar,
}));

const { ProfileSettingsPanel } = await import(
  "@/components/account/profile-settings-panel"
);

describe("ProfileSettingsPanel - narrow layouts", () => {
  afterEach(cleanup);

  it("lets native fields and the country menu shrink with the form", async () => {
    mocks.getUserProfile.mockResolvedValue({ displayName: "Ana", roles: ["teacher"] });
    render(<ProfileSettingsPanel />);
    const photo = await screen.findByLabelText("Upload profile photo");

    // Layout is measured in the browser; jsdom guards the CSS contract only.
    expect(photo.closest("form")).toHaveClass("grid-cols-1");
    for (const field of ["Public name", "Bio", "Timezone"]) {
      expect(screen.getByLabelText(field, { exact: field !== "Bio" })).toHaveClass("min-w-0");
    }
    const phone = screen.getByPlaceholderText("Phone number");
    expect(phone.closest("label")).toHaveClass("grid-cols-1");
    fireEvent.click(screen.getByText("US +1"));
    expect(screen.getByText("United States").closest("button")?.parentElement)
      .toHaveClass("max-w-full");
  });
});

describe.each([
  { label: "Upload profile photo", upload: mocks.uploadUserAvatar, success: "Profile photo updated.", replace: "Replace photo" },
  { label: "Upload certificate signature", upload: mocks.uploadTeacherSignature, success: "Certificate signature updated.", replace: "Replace signature" },
])("ProfileSettingsPanel - $label", ({ label, upload, success, replace }) => {
  beforeEach(() => {
    mocks.getUserProfile.mockReset();
    mocks.getUserProfile.mockResolvedValue({ displayName: "Ana", roles: ["teacher"] });
    mocks.uploadUserAvatar.mockReset();
    mocks.uploadTeacherSignature.mockReset();
    mocks.refreshUser.mockReset();
    mocks.refreshUser.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the native file input focusable with a visible-focus label", async () => {
    render(<ProfileSettingsPanel />);

    const input = await screen.findByLabelText<HTMLInputElement>(label);
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAccessibleName(label);
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toBeEnabled();
    // jsdom does not load Tailwind; these classes guard the display:none regression.
    expect(input).toHaveClass("sr-only");
    expect(input).not.toHaveClass("hidden");
    expect(input).not.toHaveAttribute("hidden");
    expect(input).not.toHaveAttribute("aria-hidden", "true");
    expect(input.tabIndex).toBe(0);
    expect(input.closest("label")).toHaveClass(
      "relative", "min-h-11", "focus-within:outline-2",
      "focus-within:outline-offset-2", "focus-within:outline-[var(--color-primary)]",
    );
    input.focus();
    expect(input).toHaveFocus();
  });

  it.each([
    { reason: "unsupported MIME", type: "image/svg+xml", size: 1 },
    { reason: "empty file", type: "image/png", size: 0 },
    { reason: "over 5 MB", type: "image/png", size: 5 * 1024 * 1024 + 1 },
  ])("rejects $reason without uploading", async ({ type, size }) => {
    render(<ProfileSettingsPanel />);
    const input = await screen.findByLabelText(label);
    const file = new File([new Uint8Array(size)], "image", { type });

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/^Use a .*under 5 MB.*image\.$/)).toBeInTheDocument();
    expect(mocks.uploadUserAvatar).not.toHaveBeenCalled();
    expect(mocks.uploadTeacherSignature).not.toHaveBeenCalled();
    expect(mocks.refreshUser).not.toHaveBeenCalled();
    expect(input).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // "Uploading 0%" o envio inteiro (o Storage não informa progresso) se lia
  // como "travou". Mesmo contrato do #138: sem número do transporte, sem
  // número na tela.
  it("preserves progress, disabled state and file reset until upload completes", async () => {
    let complete!: (url: string) => void;
    const pending = new Promise<string>((resolve) => { complete = resolve; });
    upload.mockImplementation(
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
        return pending;
      },
    );

    render(<ProfileSettingsPanel />);

    const input = await screen.findByLabelText<HTMLInputElement>(label);
    const file = new File(["png"], "me.png", { type: "image/png" });
    // A selected path is browser-owned; seed it so removing the reset fails here.
    Object.defineProperty(input, "value", { configurable: true, writable: true, value: "C:\\fakepath\\me.png" });
    fireEvent.change(input, {
      target: { files: [file] },
    });

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Sending...");
    expect(status).not.toHaveTextContent("%");
    expect(upload).toHaveBeenCalledExactlyOnceWith("user-1", file, expect.any(Function));
    expect(input).toBeDisabled();
    expect(input.closest("label")).toHaveClass("pointer-events-none", "opacity-60");
    expect(input.closest("label")).toHaveTextContent("Uploading...");
    expect(input.value).toBe("");
    expect(screen.queryByText(success)).not.toBeInTheDocument();

    await act(async () => { complete("https://media.example/image.png"); });

    expect(input).toBeEnabled();
    expect(input.closest("label")).not.toHaveClass("pointer-events-none");
    expect(input.closest("label")).toHaveTextContent(replace);
    expect(screen.getByText(success)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.refreshUser).toHaveBeenCalledTimes(upload === mocks.uploadUserAvatar ? 1 : 0);
  });
});
