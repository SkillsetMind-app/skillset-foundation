import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { AccountSettingsHub } from "./account-settings-hub";

const mocks = vi.hoisted(() => ({ user: { uid: "creator-test" }, tab: "notifications", replace: vi.fn(), save: vi.fn(), export: vi.fn(), remove: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: vi.fn() }), useSearchParams: () => new URLSearchParams({ tab: mocks.tab }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("./profile-settings-panel", () => ({ ProfileSettingsPanel: () => null }));
vi.mock("./security-settings-panel", () => ({ SecuritySettingsPanel: () => null }));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_: string, receive: (profile: unknown) => void) => { receive({ preferences: {} }); return () => {}; },
  updateUserPreferences: mocks.save,
}));
vi.mock("@/lib/data/account-actions", () => ({ requestDataExportAction: mocks.export, requestAccountDeletionAction: mocks.remove }));

function LocaleControl() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("en")}>EN test</button>;
}
function show() {
  return render(<I18nProvider initialLocale="es"><LocaleControl /><AccountSettingsHub /></I18nProvider>);
}

describe("account settings locale", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.tab = "notifications"; mocks.save.mockResolvedValue(undefined); mocks.export.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); });
  afterEach(cleanup);

  it("renders Spanish navigation and notification controls with untranslated route identifiers", async () => {
    show();
    expect(screen.getByRole("navigation", { name: "Secciones de configuración" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Tus preferencias de SkillsetMind." })).toBeVisible();
    expect(screen.getByRole("switch", { name: "Actividad del curso" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Privacidad y datos/ }));
    expect(mocks.replace).toHaveBeenCalledWith("/account?tab=privacy", { scroll: false });
    fireEvent.click(screen.getByRole("switch", { name: "Actividad del curso" }));
    expect(mocks.save).toHaveBeenCalledWith("creator-test", expect.objectContaining({ notifications: expect.objectContaining({ courseActivity: false }) }));
  });

  it("localizes a save failure and updates copy when the locale changes", async () => {
    mocks.save.mockRejectedValue(new Error("transport failure"));
    show();
    fireEvent.click(screen.getByRole("switch", { name: "Actividad del curso" }));
    expect(await screen.findByText("No pudimos guardar el cambio. Revisa tu conexión e inténtalo de nuevo.")).toBeVisible();
    fireEvent.click(screen.getByText("EN test"));
    expect(screen.getByText("We could not save that change. Check your connection and try again.")).toBeVisible();
  });

  it("localizes learning controls while preserving preference keys", () => {
    mocks.tab = "learning";
    show();
    fireEvent.click(screen.getByRole("switch", { name: "Mostrar subtítulos automáticamente" }));
    expect(mocks.save).toHaveBeenCalledWith("creator-test", expect.objectContaining({ learning: expect.objectContaining({ autoCaptions: expect.any(Boolean) }) }));
    expect(screen.getByRole("switch", { name: "Resumen diario de aprendizaje" })).toBeVisible();
  });

  it("requires the translated second confirmation before requesting deletion", async () => {
    mocks.tab = "privacy";
    show();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar cuenta" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar solicitud de eliminación" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    expect(await screen.findByText("Solicitud de eliminación de cuenta recibida. SkillsetMind la procesará manualmente en un plazo de 72 horas.")).toBeVisible();
    fireEvent.click(screen.getByText("EN test"));
    expect(screen.getByText("Account deletion request received. SkillsetMind will process it manually within 72 hours.")).toBeVisible();
  });

  it("shows Spanish export failures without exposing transport details", async () => {
    mocks.tab = "privacy";
    mocks.export.mockRejectedValue(new Error("private transport detail"));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Exportar todos los datos" }));
    expect(await screen.findByText("No se pudo solicitar la exportación de tus datos. Inténtalo de nuevo en un momento.")).toBeVisible();
    expect(screen.queryByText("private transport detail")).not.toBeInTheDocument();
  });
});
