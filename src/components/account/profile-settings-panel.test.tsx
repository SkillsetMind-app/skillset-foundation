import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  updateUserIdentity: vi.fn(),
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
  updateUserIdentity: mocks.updateUserIdentity,
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
    const phone = screen.getByRole("textbox", { name: "Phone number" });
    expect(phone.parentElement?.parentElement).toHaveClass("grid-cols-1");
    fireEvent.click(screen.getByRole("button", { name: "Country code: US +1 (United States)" }));
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
    // F-20: sem porcentagem, a barra indeterminada mostra que o envio anda.
    expect(status.querySelector(".upload-indeterminate-fill")).not.toBeNull();
    expect(upload).toHaveBeenCalledExactlyOnceWith("user-1", file, expect.any(Function));
    expect(input).toBeDisabled();
    expect(input.closest("label")).toHaveClass("pointer-events-none", "opacity-60");
    // O rótulo fica estável; "Uploading" aparecia aqui e na nota ao mesmo tempo.
    expect(input.closest("label")).not.toHaveTextContent("Uploading");
    expect(input.value).toBe("");
    expect(screen.queryByText(success)).not.toBeInTheDocument();

    await act(async () => { complete("https://media.example/image.png"); });

    expect(input).toBeEnabled();
    expect(input.closest("label")).not.toHaveClass("pointer-events-none");
    expect(input.closest("label")).toHaveTextContent(replace);
    expect(screen.getByText(success)).toBeInTheDocument();
    // A nota de envio saiu; o único status que fica é o "salvo" ao lado do botão.
    expect(screen.getByRole("status")).toHaveTextContent(success);
    expect(mocks.refreshUser).toHaveBeenCalledTimes(upload === mocks.uploadUserAvatar ? 1 : 0);
  });
});

describe("ProfileSettingsPanel - leitura que falha", () => {
  beforeEach(() => {
    mocks.getUserProfile.mockReset();
  });
  afterEach(cleanup);

  it("ganha \"Try again\", que lê o perfil de novo uma vez só e mostra os dados", async () => {
    let resolve!: (value: unknown) => void;
    mocks.updateUserIdentity.mockReset();
    mocks.getUserProfile
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { container } = render(<ProfileSettingsPanel />);
    expect(await screen.findByText("We could not load your profile settings.")).toBeInTheDocument();
    // Leitura falhada: nada editável (campos vazios gravariam por cima do perfil).
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save profile" })).toBeNull();
    expect(screen.queryByLabelText("Upload profile photo")).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Try again" }), { key: "Enter" });
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    const retry = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    // Lendo: a espera de sempre, sem formulário para Enter salvar.
    expect(screen.getByRole("status")).toHaveTextContent("Loading profile settings...");
    expect(screen.queryByRole("button", { name: "Save profile" })).toBeNull();
    await act(async () => resolve({ displayName: "Ana Souza", username: "anasouza", bio: "Coach de equipes", roles: ["student"] }));
    expect(screen.getByLabelText("Public name")).toHaveValue("Ana Souza");
    expect(screen.getByLabelText("Bio", { exact: false })).toHaveValue("Coach de equipes");
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("We could not load your profile settings.")).toBeNull();
  });

  it("o \"Try again\" que dá certo não traz de volta um erro de antes da falha", async () => {
    const avatarError = "Use a JPG, PNG, or WebP under 5 MB profile image.";
    mocks.getUserProfile.mockResolvedValueOnce({ displayName: "Ana", roles: ["student"] });
    const { rerender } = render(<ProfileSettingsPanel />);
    const input = await screen.findByLabelText<HTMLInputElement>("Upload profile photo");
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    expect(screen.getByText(avatarError)).toBeInTheDocument();

    // A sessão entrega a pessoa de novo (objeto novo) e essa releitura falha.
    const previousUser = mocks.user;
    mocks.user = { ...previousUser };
    mocks.getUserProfile
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ displayName: "Ana", roles: ["student"] });
    try {
      rerender(<ProfileSettingsPanel />);
      fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
      expect(await screen.findByLabelText("Public name")).toHaveValue("Ana");
      expect(screen.queryByText(avatarError)).toBeNull();
    } finally {
      mocks.user = previousUser;
    }
  });

  it("erro que não é de leitura não ganha \"Try again\"", async () => {
    mocks.getUserProfile.mockResolvedValue({ displayName: "Ana", roles: ["student"] });
    render(<ProfileSettingsPanel />);
    const input = await screen.findByLabelText<HTMLInputElement>("Upload profile photo");
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    expect(await screen.findByText("Use a JPG, PNG, or WebP under 5 MB profile image.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
