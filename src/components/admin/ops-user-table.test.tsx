import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("shows the person with status and the name leads to the dossier", async () => {
    render(table());
    const link = await screen.findByRole("link", { name: "Ana" });
    expect(link).toHaveAttribute("href", "/ops/users/u%201");
    // "Blocked" is also an option of the status filter: the badge is the one that is not an <option>.
    const chip = screen.getAllByText("Blocked").find((node) => node.tagName !== "OPTION");
    // Blocked asks for attention: red, not the draft gray (I-05).
    expect(chip).toHaveClass("status-chip--danger");
    expect(screen.getByText(/Never signed in/)).toBeInTheDocument();
  });

  it("lists people in a table with columns, not in cards", async () => {
    render(table());
    await screen.findByRole("link", { name: "Ana" });
    const grid = screen.getByRole("table");
    expect(grid.closest("[role=region]")).toHaveClass("overflow-x-auto");
    expect(screen.getAllByRole("columnheader").map((head) => head.textContent))
      .toEqual(["Person", "Level", "Status", "Joined", "Last sign-in", "Actions"]);
    const [, row] = screen.getAllByRole("row");
    const cells = row.querySelectorAll("td");
    expect(cells[0]).toHaveTextContent("Ana");
    expect(cells[0]).toHaveTextContent("ana@example.test");
    expect(cells[3]).toHaveTextContent(new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(ana.createdAt)));
    expect(cells[4]).toHaveTextContent("Never signed in");
  });

  it("pagination and filter go to the database, and a filter returns to the first page", async () => {
    mocks.search.mockResolvedValue({ total: 120, users: [ana] });
    render(table());
    await screen.findByRole("link", { name: "Ana" });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(mocks.search).toHaveBeenLastCalledWith({ search: "", status: null, role: null, page: 1 }));
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "suspended" } });
    await waitFor(() => expect(mocks.search).toHaveBeenLastCalledWith({ search: "", status: "suspended", role: null, page: 0 }));
  });

  it("a new search keeps the old list in place, dimmed and busy, until the response (I-12)", async () => {
    render(table());
    await screen.findByRole("link", { name: "Ana" });
    expect(screen.getByRole("region")).not.toHaveAttribute("aria-busy");
    let finish!: (page: unknown) => void;
    mocks.search.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find someone" }), { target: { value: "ana" } });
    // From the first keystroke, before the 300ms delay.
    expect(screen.getByRole("link", { name: "Ana" })).toBeInTheDocument();
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("region")).toHaveClass("opacity-60");
    expect(document.querySelector("[data-searching]")).not.toBeNull();
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
    await act(async () => finish({ total: 1, users: [ana] }));
    expect(screen.getByRole("region")).not.toHaveAttribute("aria-busy");
    expect(document.querySelector("[data-searching]")).toBeNull();
  });

  it("without 2FA shows the way to turn it on, not a generic error", async () => {
    mocks.search.mockRejectedValue({ message: "OPS_ADMIN_MFA_REQUIRED" });
    render(table());
    expect(await screen.findByRole("link", { name: "Set up two-factor authentication" })).toHaveAttribute("href", "/account/security");
  });

  it("closing the account control reloads the list", async () => {
    render(table());
    await screen.findByRole("link", { name: "Ana" });
    fireEvent.click(screen.getByRole("button", { name: "Account access" }));
    fireEvent.click(screen.getByRole("button", { name: "dialog for ana@example.test" }));
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
  });

  it("speaks Spanish", async () => {
    render(table("es"));
    await screen.findByRole("link", { name: "Ana" });
    expect(screen.getAllByText("Bloqueada").some((node) => node.tagName !== "OPTION")).toBe(true);
    expect(screen.getByRole("combobox", { name: "Estado" })).toBeInTheDocument();
  });
});
