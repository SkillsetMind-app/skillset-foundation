import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";
import { AccountSettingsHub } from "./account-settings-hub";

const mocks = vi.hoisted(() => ({
  user: { uid: "creator-test" }, tab: "notifications", replace: vi.fn(), save: vi.fn(), export: vi.fn(), remove: vi.fn(),
  // "data": the profile arrives right away; "pending": not here yet; "error": the read failed.
  profileMode: "data" as "data" | "pending" | "error",
  profile: { preferences: {} } as unknown,
  receive: (() => undefined) as (profile: unknown) => void,
  reload: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: vi.fn() }), useSearchParams: () => new URLSearchParams({ tab: mocks.tab }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("./profile-settings-panel", () => ({ ProfileSettingsPanel: () => null }));
vi.mock("./security-settings-panel", () => ({ SecuritySettingsPanel: () => null }));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_: string, receive: (profile: unknown) => void, fail: (error: Error) => void) => {
    mocks.receive = receive;
    if (mocks.profileMode === "data") receive(mocks.profile);
    if (mocks.profileMode === "error") fail(new Error("offline"));
    return Object.assign(() => {}, { reload: mocks.reload });
  },
  updateUserPreferences: mocks.save,
}));
vi.mock("@/lib/data/account-actions", () => ({ requestDataExportAction: mocks.export, requestAccountDeletionAction: mocks.remove }));

function LocaleControl() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("en")}>EN test</button>;
}
// "Eliminar cuenta" asks in a <dialog>; jsdom has no showModal/close.
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
function stubDialog() {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
}
function restoreDialog() {
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
}

function show() {
  return render(<I18nProvider initialLocale="es"><LocaleControl /><AccountSettingsHub /></I18nProvider>);
}

describe("account settings locale", () => {
  beforeEach(() => { vi.clearAllMocks(); stubDialog(); mocks.tab = "notifications"; mocks.profileMode = "data"; mocks.profile = { preferences: {} }; mocks.save.mockResolvedValue(undefined); mocks.export.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); });
  afterEach(() => { cleanup(); restoreDialog(); vi.useRealTimers(); });

  it("before the profile arrives the switches show no position; afterwards they come in already on the saved choice", () => {
    mocks.profileMode = "pending";
    show();
    // The text already shows, but no switch with the default pretending to be the saved value.
    expect(screen.getByText("Actividad del curso")).toBeVisible();
    expect(screen.queryByRole("switch")).toBeNull();
    act(() => mocks.receive({ preferences: { notifications: { courseActivity: false } } }));
    expect(screen.getByRole("switch", { name: "Actividad del curso" })).toHaveAttribute("aria-checked", "false");
  });

  it("if the read fails: error with 'Intentar de nuevo' and no switch to write the default over the saved value", () => {
    mocks.profileMode = "error";
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus preferencias guardadas.");
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => mocks.receive({ preferences: {} }));
    expect(screen.getByRole("switch", { name: "Actividad del curso" })).toBeEnabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("renders Spanish navigation and notification controls with untranslated route identifiers", async () => {
    show();
    expect(screen.getByRole("navigation", { name: "Secciones de configuración" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Decide qué merece tu atención." })).toBeVisible();
    expect(screen.getByRole("switch", { name: "Actividad del curso" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Privacidad y datos/ }));
    expect(mocks.replace).toHaveBeenCalledWith("/account?tab=privacy", { scroll: false });
    // The whole row is the switch: the label and description text are inside the target.
    const row = screen.getByRole("switch", { name: "Actividad del curso" });
    expect(row).toHaveTextContent("Reseñas, comentarios");
    // The name is only the label; what the switch does is read as the description.
    expect(row).toHaveAccessibleDescription("Reseñas, comentarios, actividad de las lecciones y logros de los estudiantes.");
    fireEvent.click(row);
    expect(mocks.save).toHaveBeenCalledWith("creator-test", expect.objectContaining({ notifications: expect.objectContaining({ courseActivity: false }) }));
  });

  it("says Guardado on the row that changed and disappears after 2s", async () => {
    show();
    fireEvent.click(screen.getByRole("switch", { name: "Actividad del curso" }));
    const saved = await screen.findByRole("status");
    expect(saved).toHaveTextContent("Guardado");
    expect(saved.previousElementSibling).toBe(screen.getByRole("switch", { name: "Actividad del curso" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull(), { timeout: 3000 });
  });

  it("localizes a save failure and updates copy when the locale changes", async () => {
    mocks.save.mockRejectedValue(new Error("transport failure"));
    show();
    fireEvent.click(screen.getByRole("switch", { name: "Actividad del curso" }));
    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent("No pudimos guardar el cambio. Revisa tu conexión e inténtalo de nuevo.");
    // The error stays under the switch that failed, not at the top of the card.
    expect(failure.previousElementSibling).toBe(screen.getByRole("switch", { name: "Actividad del curso" }));
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
    // Only Date is fake: confirm ignores clicks in the first 500ms.
    vi.useFakeTimers({ toFake: ["Date"] });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar cuenta" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    // The confirmation lives in a dialog, not in place of the first button: a
    // double click on "Eliminar cuenta" no longer requests the deletion.
    expect(screen.getByRole("button", { name: "Eliminar cuenta" })).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "¿Eliminar tu cuenta?" });
    expect(dialog).toHaveTextContent("Las solicitudes se gestionan manualmente");
    // The 2nd tap of a double tap arrives right on top of the opening and is discarded.
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar solicitud de eliminación" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar solicitud de eliminación" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Solicitud de eliminación de cuenta recibida. SkillsetMind la procesará en un plazo de 30 días una vez verificada la solicitud.")).toBeVisible();
    fireEvent.click(screen.getByText("EN test"));
    expect(screen.getByText("Account deletion request received. SkillsetMind will process it within 30 days once the request is verified.")).toBeVisible();
  });

  it("canceling the deletion closes the dialog without requesting anything", () => {
    mocks.tab = "privacy";
    show();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar cuenta" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
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
