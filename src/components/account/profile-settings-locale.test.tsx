import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileSettingsPanel } from "@/components/account/profile-settings-panel";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { maxCredentialEntries, maxCredentialLength } from "@/domain/user-profile";
import type { UploadAvatarProgress } from "@/lib/data/profile-media";

const mocks = vi.hoisted(() => ({
  router: { refresh: vi.fn() },
  user: { uid: "profile-user", displayName: "Ana", email: "ana@example.test", roles: ["teacher"] },
  getUserProfile: vi.fn(),
  updateUserIdentity: vi.fn(),
  uploadUserAvatar: vi.fn(),
  uploadTeacherSignature: vi.fn(),
  refreshUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, refreshUser: mocks.refreshUser }),
}));
vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  updateUserIdentity: mocks.updateUserIdentity,
}));
vi.mock("@/lib/data/profile-media", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/data/profile-media")>(),
  uploadUserAvatar: mocks.uploadUserAvatar,
  uploadTeacherSignature: mocks.uploadTeacherSignature,
}));

const profile = {
  displayName: "Ana Rivera",
  username: "ana-rivera",
  bio: "My English bio stays mine: $&",
  phoneNumber: "+15551234567",
  timezone: "Pacific/Auckland",
  goals: ["teach_online"],
  credentials: ["Professor at University of Sao Paulo"],
  roles: ["teacher"],
};

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}

// Uses shipped dictionaries, including accountProfile once the parent merges the string map.
function renderProfile(locale: "en" | "es" = "es") {
  return render(
    <I18nProvider initialLocale={locale}>
      <ChangeLanguage />
      <ProfileSettingsPanel />
    </I18nProvider>,
  );
}

function changeLanguage() {
  fireEvent.click(screen.getByRole("button", { name: "Change language" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUserProfile.mockResolvedValue(profile);
  mocks.updateUserIdentity.mockResolvedValue(undefined);
  mocks.refreshUser.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("profile settings locale", () => {
  it("translates pending load and its failure without refetching", async () => {
    let reject!: (reason: Error) => void;
    mocks.getUserProfile.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    renderProfile();
    expect(screen.getByText("Cargando los ajustes del perfil...")).toBeInTheDocument();
    changeLanguage();
    expect(screen.getByText("Loading profile settings...")).toBeInTheDocument();
    await act(async () => reject(new Error("Internal profile service failure")));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your profile settings.");
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los ajustes de tu perfil.");
    expect(screen.queryByText("Internal profile service failure")).not.toBeInTheDocument();
    expect(mocks.getUserProfile).toHaveBeenCalledExactlyOnceWith("profile-user");
  });

  it("translates controls and persists original data values after switching language", async () => {
    let complete!: () => void;
    mocks.updateUserIdentity.mockReturnValue(new Promise<void>((resolve) => { complete = resolve; }));
    const { container } = renderProfile();
    expect(await screen.findByRole("heading", { name: "Ajustes del perfil" })).toBeInTheDocument();
    for (const text of ["Identidad de la cuenta", "Foto de perfil", "Credenciales", "Sin firma", "Objetivos"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText(/Usa una imagen cuadrada/)).toHaveTextContent("JPG, PNG o WebP de menos de 5 MB");
    expect(screen.getByText(/Opcional\. Sube tu firma/)).toHaveTextContent("PNG transparente");
    const credential = screen.getByPlaceholderText("Ej.: Profesor en la Universidad de S\u00e3o Paulo");
    expect(credential).toHaveValue(profile.credentials[0]);
    expect(screen.getByRole("button", { name: "Eliminar credencial 1" })).toHaveTextContent("Eliminar");
    fireEvent.click(screen.getByRole("button", { name: "A\u00f1adir credencial" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar credencial 2" }));
    fireEvent.change(screen.getByLabelText("Nombre p\u00fablico"), { target: { value: "Ana $& Edited" } });
    fireEvent.change(credential, { target: { value: "  My English credential $&  " } });
    fireEvent.change(screen.getByLabelText(/Nombre de usuario/), { target: { value: "@ANA-EDITED" } });
    expect(screen.getByDisplayValue(profile.bio)).toBeInTheDocument();
    expect(screen.getByText(`${profile.bio.trim().length}/280 caracteres`)).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("Pacific/Auckland");
    expect(Array.from(screen.getByRole("combobox").querySelectorAll("option"), (option) => option.value)).toEqual([
      "Pacific/Auckland", "America/New_York", "America/Sao_Paulo", "America/Los_Angeles",
      "Europe/London", "Africa/Lagos", "Africa/Johannesburg",
    ]);
    expect(screen.getByRole("button", { name: "Ense\u00f1ar en l\u00ednea" })).toHaveAttribute("aria-pressed", "true");
    for (const goal of ["Crecimiento profesional", "Aprendizaje verificado", "Crear una comunidad", "Mentor\u00eda en vivo", "Formaci\u00f3n de equipos"]) {
      fireEvent.click(screen.getByRole("button", { name: goal }));
    }
    changeLanguage();
    expect(screen.getByLabelText("Public name")).toHaveValue("Ana $& Edited");
    expect(screen.getByDisplayValue(profile.bio)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Professor at University of S\u00e3o Paulo")).toHaveValue("  My English credential $&  ");
    expect(screen.getByRole("combobox")).toHaveValue("Pacific/Auckland");
    expect(screen.getByRole("button", { name: "Team training" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    changeLanguage();
    expect(screen.getByRole("button", { name: "Guardando..." })).toBeDisabled();
    await act(async () => complete());
    expect(screen.getByText("Perfil actualizado.")).toBeInTheDocument();
    changeLanguage();
    expect(screen.getByText("Profile updated.")).toBeInTheDocument();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
    expect(mocks.updateUserIdentity).toHaveBeenCalledExactlyOnceWith("profile-user", {
      displayName: "Ana $& Edited", username: "ana-edited", bio: profile.bio,
      phoneNumber: profile.phoneNumber, timezone: "Pacific/Auckland",
      credentials: ["My English credential $&"],
      goals: ["teach_online", "career_growth", "skill_certification", "build_community", "live_mentorship", "business_training"],
    });
  });

  it.each([
    { patch: { displayName: "A" }, es: "Escribe el nombre que la gente", en: "Enter the name people" },
    { patch: { displayName: "A".repeat(121) }, es: "120 caracteres", en: "120 characters" },
    { patch: { username: "" }, es: "Elige un nombre de usuario", en: "Choose a username" },
    { patch: { username: "bad username" }, es: "Usa de 3 a 32", en: "Use 3-32" },
    { patch: { bio: "a".repeat(281) }, es: "280 caracteres", en: "280 characters" },
    { patch: { credentials: Array.from({ length: maxCredentialEntries + 1 }, () => "Credential") }, es: `A\u00f1ade hasta ${maxCredentialEntries} credenciales.`, en: `Add up to ${maxCredentialEntries} credentials.` },
    { patch: { credentials: ["a".repeat(maxCredentialLength + 1)] }, es: `${maxCredentialLength} caracteres`, en: `${maxCredentialLength} characters` },
    { patch: { phoneNumber: "+112" }, es: "Introduce un n\u00famero de tel\u00e9fono v\u00e1lido.", en: "Use a valid phone number." },
    { patch: { timezone: "" }, es: "Elige tu zona horaria.", en: "Choose your timezone." },
  ])("retranslates validation without resubmitting: $en", async ({ patch, es, en }) => {
    mocks.getUserProfile.mockResolvedValue({ ...profile, ...patch });
    const { container } = renderProfile();
    await screen.findByRole("button", { name: "Guardar perfil" });
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent(es);
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent(en);
    expect(screen.getByRole("alert")).not.toHaveTextContent("{max}");
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
  });

  it("keeps save failures actionable and private while preserving edits", async () => {
    mocks.updateUserIdentity.mockRejectedValue({ message: "Internal database failure", code: "XX000" });
    const { container } = renderProfile();
    fireEvent.change(await screen.findByLabelText("Nombre p\u00fablico"), { target: { value: "Edited name" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("contacta con soporte");
    expect(container).not.toHaveTextContent("Internal database failure");
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("Try again, and contact support");
    expect(screen.getByLabelText("Public name")).toHaveValue("Edited name");
    expect(mocks.updateUserIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
  });

  it("preserves student-only fields and does not submit teacher credentials", async () => {
    mocks.getUserProfile.mockResolvedValue({ ...profile, roles: ["student"], credentials: [] });
    const { container } = renderProfile();
    await screen.findByRole("button", { name: "Guardar perfil" });
    expect(screen.queryByText("Credenciales")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Subir firma para los certificados")).not.toBeInTheDocument();
    changeLanguage();
    fireEvent.submit(container.querySelector("form")!);
    await screen.findByText("Profile updated.");
    expect(mocks.updateUserIdentity.mock.calls[0][1]).not.toHaveProperty("credentials");
    expect(mocks.updateUserIdentity.mock.calls[0][1]).toMatchObject({ phoneNumber: profile.phoneNumber, goals: profile.goals, timezone: profile.timezone });
  });
});

describe.each([
  { label: "Subir foto de perfil", enLabel: "Upload profile photo", upload: mocks.uploadUserAvatar, success: "Foto de perfil actualizada.", enSuccess: "Profile photo updated.", replace: "Reemplazar foto", error: "No pudimos subir tu foto de perfil.", enError: "We could not upload your profile photo." },
  { label: "Subir firma para los certificados", enLabel: "Upload certificate signature", upload: mocks.uploadTeacherSignature, success: "Firma para los certificados actualizada.", enSuccess: "Certificate signature updated.", replace: "Reemplazar firma", error: "No pudimos subir tu firma.", enError: "We could not upload your signature." },
])("profile uploads: $enLabel", ({ label, enLabel, upload, success, enSuccess, replace, error, enError }) => {
  it.each([
    { type: "image/svg+xml", size: 1 },
    { type: "image/png", size: 0 },
    { type: "image/png", size: 5 * 1024 * 1024 + 1 },
  ])("retains file validation and localizes its saved error: $type / $size", async ({ type, size }) => {
    renderProfile();
    const input = await screen.findByLabelText(label);
    const file = new File(["x"], "bad-image", { type });
    Object.defineProperty(file, "size", { value: size });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByRole("alert").textContent).toBe(upload === mocks.uploadUserAvatar
      ? "Usa una imagen de perfil JPG, PNG o WebP de menos de 5 MB."
      : "Usa una imagen PNG, JPG o WebP de menos de 5 MB (un PNG transparente se ve mejor).");
    changeLanguage();
    expect(screen.getByRole("alert").textContent).toBe(upload === mocks.uploadUserAvatar
      ? "Use a JPG, PNG, or WebP under 5 MB profile image."
      : "Use a PNG, JPG, or WebP under 5 MB (transparent PNG looks best) image.");
    expect(input).toBeEnabled();
    expect(mocks.uploadUserAvatar).not.toHaveBeenCalled();
    expect(mocks.uploadTeacherSignature).not.toHaveBeenCalled();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
  });

  it("switches during upload without duplicate writes and retranslates success", async () => {
    let complete!: (url: string) => void;
    let progress!: (value: UploadAvatarProgress) => void;
    upload.mockImplementation((_uid: string, file: File, onProgress: typeof progress) => {
      progress = onProgress;
      onProgress({ bytesTransferred: 0, totalBytes: file.size, percent: null, state: "running" });
      return new Promise<string>((resolve) => { complete = resolve; });
    });
    renderProfile();
    const input = await screen.findByLabelText<HTMLInputElement>(label);
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    const file = new File(["png"], "unchanged-name.png", { type: "image/png" });
    Object.defineProperty(input, "value", { configurable: true, writable: true, value: "C:\\fakepath\\unchanged-name.png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByRole("status")).toHaveTextContent("Enviando...");
    expect(screen.getByRole("status")).not.toHaveTextContent("%");
    expect(input).toBeDisabled();
    expect(input.value).toBe("");
    changeLanguage();
    expect(screen.getByLabelText(enLabel)).toBe(input);
    expect(input.closest("label")).toHaveTextContent("Uploading...");
    expect(screen.getByRole("status")).toHaveTextContent("Sending...");
    act(() => progress({ bytesTransferred: 1, totalBytes: 3, percent: 33, state: "running" }));
    expect(screen.getByRole("status")).toHaveTextContent("33%");
    expect(screen.getByRole("status")).toHaveTextContent("1 B of 3 B");
    changeLanguage();
    expect(screen.getByRole("status")).toHaveTextContent("1 B de 3 B");
    expect(input.closest("label")).toHaveTextContent("Subiendo...");
    await act(async () => complete("https://media.example.test/uploaded.png"));
    expect(screen.getByText(success)).toBeInTheDocument();
    expect(input.closest("label")).toHaveTextContent(replace);
    expect(input).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    if (upload === mocks.uploadTeacherSignature) {
      expect(screen.getByAltText("Tu firma para los certificados")).toHaveAttribute("src", "https://media.example.test/uploaded.png");
    }
    changeLanguage();
    expect(screen.getByText(enSuccess)).toBeInTheDocument();
    expect(upload).toHaveBeenCalledExactlyOnceWith("profile-user", file, expect.any(Function));
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
    expect(mocks.refreshUser).toHaveBeenCalledTimes(upload === mocks.uploadUserAvatar ? 1 : 0);
  });

  it.each([new Error("Raw English transport detail"), { message: "Raw English transport detail", statusCode: "403" }])("never displays raw transport errors", async (failure) => {
    upload.mockRejectedValue(failure);
    const { container } = renderProfile();
    fireEvent.change(await screen.findByLabelText(label), {
      target: { files: [new File(["png"], "photo.png", { type: "image/png" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(error);
    expect(screen.getByRole("alert")).toHaveTextContent("iniciar sesi\u00f3n o contacta con soporte");
    expect(container).not.toHaveTextContent("Raw English transport detail");
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent(enError);
    expect(screen.getByLabelText(enLabel)).toBeEnabled();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
  });
});
