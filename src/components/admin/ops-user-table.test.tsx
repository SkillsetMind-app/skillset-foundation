import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpsUserTable } from "@/components/admin/ops-user-table";
import { I18nProvider } from "@/components/i18n/i18n-provider";

const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/lib/data/ops-users", () => ({ OPS_USERS_PAGE_SIZE: 50, searchOpsUsers: mocks.search }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/ops",
  useSearchParams: () => new URLSearchParams("tab=users"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/components/admin/account-control-dialog", () => ({
  AccountControlDialog: ({ label, onClose }: { label: string; onClose: () => void }) => (
    <button type="button" onClick={onClose}>dialog for {label}</button>
  ),
}));

const ana = {
  uid: "u 1", email: "ana@example.test", displayName: "Ana", roles: ["teacher"],
  createdAt: "2026-09-01T00:00:00Z", lastSignInAt: null, status: "blocked",
};

function table(locale: "en" | "es" = "en") {
  return <I18nProvider initialLocale={locale}><OpsUserTable /></I18nProvider>;
}

beforeEach(() => mocks.search.mockResolvedValue({ total: 1, users: [ana] }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("OpsUserTable", () => {
  it("mostra a pessoa com status e o nome leva ao dossiê", async () => {
    render(table());
    const link = await screen.findByRole("link", { name: "Ana" });
    expect(link).toHaveAttribute("href", "/ops/users/u%201");
    // "Blocked" também é opção do filtro de status: o selo é o que não é <option>.
    expect(screen.getAllByText("Blocked").some((node) => node.tagName !== "OPTION")).toBe(true);
    expect(screen.getByText(/Never signed in/)).toBeInTheDocument();
  });

  it("paginação e filtro vão para o banco, e filtro volta para a primeira página", async () => {
    mocks.search.mockResolvedValue({ total: 120, users: [ana] });
    render(table());
    await screen.findByRole("link", { name: "Ana" });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(mocks.search).toHaveBeenLastCalledWith({ search: "", status: null, role: null, page: 1 }));
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "suspended" } });
    await waitFor(() => expect(mocks.search).toHaveBeenLastCalledWith({ search: "", status: "suspended", role: null, page: 0 }));
  });

  it("sem 2FA mostra o caminho para ativar, não um erro genérico", async () => {
    mocks.search.mockRejectedValue({ message: "OPS_ADMIN_MFA_REQUIRED" });
    render(table());
    expect(await screen.findByRole("link", { name: "Set up two-factor authentication" })).toHaveAttribute("href", "/account/security");
  });

  it("fechar o controle de conta recarrega a lista", async () => {
    render(table());
    await screen.findByRole("link", { name: "Ana" });
    fireEvent.click(screen.getByRole("button", { name: "Account access" }));
    fireEvent.click(screen.getByRole("button", { name: "dialog for ana@example.test" }));
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
  });

  it("fala espanhol", async () => {
    render(table("es"));
    await screen.findByRole("link", { name: "Ana" });
    expect(screen.getAllByText("Bloqueada").some((node) => node.tagName !== "OPTION")).toBe(true);
    expect(screen.getByRole("combobox", { name: "Estado" })).toBeInTheDocument();
  });
});
