import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountActionRequestsPanel } from "@/components/admin/account-action-requests-panel";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { AccountActionRequest } from "@/lib/data/account-actions";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), resolve: vi.fn(), user: { uid: "admin-$$-$&" } as { uid: string } | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/account-actions", () => ({ subscribeToAccountActionRequests: mocks.subscribe, resolveAccountActionRequest: mocks.resolve }));
const request: AccountActionRequest = { id: "request-$$-$&", type: "data_export", requestedBy: "person-$$-$&", email: "ana@example.test", status: "pending", requestedAt: "2026-09-04T12:00:00.000Z", updatedAt: null, resolvedBy: null, resolvedAt: null };
function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function panel() { return <I18nProvider initialLocale="en"><ChangeLanguage /><AccountActionRequestsPanel /></I18nProvider>; }
function language() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
function deliver(rows = [request]) { act(() => mocks.subscribe.mock.calls[0][0](rows)); }
beforeEach(() => { vi.clearAllMocks(); mocks.user = { uid: "admin-$$-$&" }; mocks.subscribe.mockImplementation(() => vi.fn()); mocks.resolve.mockResolvedValue(undefined); });
afterEach(cleanup);

describe("account request presentation and canonical actions", () => {
  it("translates request type, timestamps and actor without rewriting identities", () => {
    render(panel());
    deliver([{ ...request, status: "processing", resolvedBy: "actor-$$-$&", resolvedAt: "invalid-date" }, { ...request, id: "delete-a", type: "account_deletion", requestedAt: null, status: "rejected" }]);
    language();
    expect(screen.getByText("Exportación de datos")).toBeInTheDocument();
    expect(screen.getByText("Eliminación de cuenta")).toBeInTheDocument();
    expect(screen.getByText("En proceso")).toBeInTheDocument();
    expect(screen.getByText("Rechazado")).toBeInTheDocument();
    const date = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.requestedAt!));
    expect(screen.getByText(`Solicitada ${date} - ID de solicitud ${request.id}`)).toBeInTheDocument();
    expect(screen.getByText("Gestionada Fecha pendiente por actor-$$-$&")).toBeInTheDocument();
    expect(screen.getByText("Solicitada Fecha pendiente - ID de solicitud delete-a")).toBeInTheDocument();
    expect(screen.getAllByText(`Usuario ${request.requestedBy} - ${request.email}`)).toHaveLength(2);
    expect(screen.getByText(/Cambiar el estado no exporta datos ni elimina una cuenta/)).toBeInTheDocument();
    language();
    expect(screen.getByText("Data export")).toBeInTheDocument();
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it.each([
    ["processing", "Marcar en proceso", "En proceso"],
    ["completed", "Marcar completada", "Completado"],
    ["rejected", "Rechazar", "Rechazado"],
  ] as const)("keeps resolution %s and the actor canonical through a pending request", async (status, label, statusLabel) => {
    let finish!: () => void;
    mocks.resolve.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(panel());
    deliver();
    language();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(mocks.resolve).toHaveBeenCalledWith(request.id, status, "admin-$$-$&");
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.queryByText(statusLabel, { exact: true })).toBeNull();
    for (const button of screen.getAllByRole("button").filter(button => button.textContent !== "Change language")) expect(button).toBeDisabled();
    language();
    await act(async () => finish());
    expect(screen.getByText("Pending")).toBeInTheDocument();
    deliver([{ ...request, status }]);
    language();
    expect(screen.getByText(statusLabel, { exact: true })).toBeInTheDocument();
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it("retains the pending request and translates a safe update error", async () => {
    mocks.resolve.mockRejectedValue(new Error("Private update detail"));
    render(panel());
    deliver();
    fireEvent.click(screen.getByRole("button", { name: "Mark completed" }));
    await screen.findByRole("alert");
    language();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos actualizar esta solicitud de cuenta.");
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.queryByText("Completado")).toBeNull();
    expect(screen.queryByText("Private update detail")).toBeNull();
  });

  it("distinguishes failed loading from empty and recovers without changing language", () => {
    render(panel());
    expect(screen.getByRole("status")).toHaveTextContent("Loading account action requests");
    act(() => mocks.subscribe.mock.calls[0][1](new Error("Private read detail")));
    language();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar las solicitudes de cuenta.");
    expect(screen.queryByText("Todavía no hay solicitudes de cuenta.")).toBeNull();
    deliver([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Todavía no hay solicitudes de cuenta.")).toBeInTheDocument();
  });

  it("keeps the existing no-session write guard", () => {
    mocks.user = null;
    render(panel());
    deliver();
    language();
    fireEvent.click(screen.getByRole("button", { name: "Marcar completada" }));
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
