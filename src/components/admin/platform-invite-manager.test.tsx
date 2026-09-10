import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformInviteManager } from "@/components/admin/platform-invite-manager";
import { RoleManager } from "@/components/admin/role-manager";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { PlatformInvite } from "@/domain/platform-invites";

const mocks = vi.hoisted(() => ({
  listPlatformInvites: vi.fn(), createPlatformInvite: vi.fn(), resendPlatformInvite: vi.fn(),
  revokePlatformInvite: vi.fn(), setActivationWaiver: vi.fn(), listPlatformUsers: vi.fn(), setUserRoles: vi.fn(),
}));
vi.mock("@/lib/data/platform-invites", () => mocks);
vi.mock("@/lib/data/platform-roles", () => mocks);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const invitation: PlatformInvite = {
  id: "invite-1", email: "person@example.com", access_level: "teacher", waive_activation: false,
  created_at: "2026-09-09T00:00:00Z", expires_at: "2099-09-09T00:00:00Z", accepted_at: null, revoked_at: null,
};

beforeEach(() => {
  mocks.listPlatformInvites.mockResolvedValue([]);
  mocks.listPlatformUsers.mockResolvedValue([{ uid: "user-1", email: "person@example.com", displayName: "Person", roles: ["teacher"], verificationStatus: null, createdAt: null }]);
  mocks.createPlatformInvite.mockResolvedValue({ invite: invitation, emailStatus: "sent" });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });

function fill(level: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: invitation.email } });
  fireEvent.change(screen.getByLabelText("Access level"), { target: { value: level } });
}

describe("Platform invitations", () => {
  it("uses paired theme colors for the email and access-level fields", async () => {
    render(<PlatformInviteManager />);
    await screen.findByText("No invitations yet.");
    for (const label of ["Email", "Access level"]) {
      expect(screen.getByLabelText(label)).toHaveClass("bg-[var(--color-surface)]", "text-[var(--color-ink)]");
      expect(screen.getByLabelText(label)).not.toHaveClass("bg-white");
    }
  });

  it("does not create while the initial list could overwrite the saved invitation", async () => {
    let finish!: (rows: PlatformInvite[]) => void;
    mocks.listPlatformInvites.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<PlatformInviteManager />);
    fill("student");
    const send = screen.getByRole("button", { name: "Send invitation" });
    expect(send).toBeDisabled();
    fireEvent.submit(send.closest("form")!);
    expect(mocks.createPlatformInvite).not.toHaveBeenCalled();
    await act(async () => finish([]));
    expect(send).toBeEnabled();
  });

  it("requires deliberate admin confirmation, including when the recipient changes", async () => {
    render(<PlatformInviteManager />);
    await screen.findByText("No invitations yet.");
    fill("admin");
    const send = screen.getByRole("button", { name: "Send invitation" });
    expect(send).toBeDisabled();
    fireEvent.submit(send.closest("form")!);
    expect(mocks.createPlatformInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(send).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "other@example.com" } });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(send);
    await waitFor(() => expect(mocks.createPlatformInvite).toHaveBeenCalledWith({ email: "other@example.com", accessLevel: "admin", waiveActivation: false }));
  });

  it("defaults the teacher waiver to false and clears it when switching levels", async () => {
    render(<PlatformInviteManager />);
    await screen.findByText("No invitations yet.");
    fill("teacher");
    expect(screen.getByLabelText("Waive activation fee")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Waive activation fee"));
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "staff" } });
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "teacher" } });
    expect(screen.getByLabelText("Waive activation fee")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(mocks.createPlatformInvite).toHaveBeenCalledWith({ email: invitation.email, accessLevel: "teacher", waiveActivation: false }));
  });

  it("sends a teacher waiver only after it is checked", async () => {
    render(<PlatformInviteManager />);
    await screen.findByText("No invitations yet.");
    fill("teacher");
    fireEvent.click(screen.getByLabelText("Waive activation fee"));
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(mocks.createPlatformInvite).toHaveBeenCalledWith({ email: invitation.email, accessLevel: "teacher", waiveActivation: true }));
  });

  it("keeps a saved invite and its unsent email warning across tab switches, then resends", async () => {
    mocks.createPlatformInvite.mockResolvedValue({ invite: invitation, emailStatus: "failed" });
    let finish!: (value: { invite: PlatformInvite; emailStatus: "sent" }) => void;
    mocks.resendPlatformInvite.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<RoleManager />);
    fireEvent.click(screen.getByRole("button", { name: "Invitations" }));
    await screen.findByText("No invitations yet.");
    fill("teacher");
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    const row = await screen.findByRole("listitem");
    expect(within(row).getByText(/Invitation saved, but the email was not sent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "What each level can do" }));
    fireEvent.click(screen.getByRole("button", { name: "Invitations" }));
    expect(within(row).getByText(/email was not sent/)).toBeVisible();
    fireEvent.click(within(row).getByRole("button", { name: "Resend" }));
    expect(within(row).getByRole("button", { name: "Revoke" })).toBeDisabled();
    await act(async () => finish({ invite: invitation, emailStatus: "sent" }));
    expect(mocks.resendPlatformInvite).toHaveBeenCalledWith(invitation.id);
    expect(within(row).queryByText(/email was not sent/)).toBeNull();
    expect(within(row).getByText("Invitation saved. Email sent.")).toBeInTheDocument();
  });

  it("shows expiry and terminal states, requiring confirmation to revoke", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mocks.listPlatformInvites.mockResolvedValue([
      invitation,
      { ...invitation, id: "expired", expires_at: "2020-01-01T00:00:00Z" },
      { ...invitation, id: "accepted", accepted_at: "2026-09-09T01:00:00Z" },
      { ...invitation, id: "revoked", revoked_at: "2026-09-09T01:00:00Z" },
    ]);
    mocks.revokePlatformInvite.mockResolvedValue(undefined);
    render(<PlatformInviteManager />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows[1]).toHaveTextContent("Expired");
    for (const row of rows.slice(2)) {
      expect(within(row).getByRole("button", { name: "Resend" })).toBeDisabled();
      expect(within(row).getByRole("button", { name: "Revoke" })).toBeDisabled();
    }
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Revoke" }));
    expect(mocks.revokePlatformInvite).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(within(rows[0]).getByRole("button", { name: "Resend" })).toBeDisabled());
    expect(mocks.revokePlatformInvite).toHaveBeenCalledWith(invitation.id);
    expect(await screen.findByText("Invitation revoked.")).toBeInTheDocument();
  });

  it("blocks expired resend without calling the API but still permits revocation", async () => {
    mocks.listPlatformInvites.mockResolvedValue([{ ...invitation, expires_at: "2020-01-01T00:00:00Z" }]);
    mocks.revokePlatformInvite.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PlatformInviteManager />);
    const resend = await screen.findByRole("button", { name: "Resend" });
    expect(resend).toBeDisabled();
    fireEvent.click(resend);
    expect(mocks.resendPlatformInvite).not.toHaveBeenCalled();
    const revoke = screen.getByRole("button", { name: "Revoke" });
    expect(revoke).toBeEnabled();
    fireEvent.click(revoke);
    await screen.findByText("Invitation revoked.");
    expect(mocks.revokePlatformInvite).toHaveBeenCalledWith(invitation.id);
    expect(mocks.resendPlatformInvite).not.toHaveBeenCalled();
  });

  it("checks the current clock before resend even before the status timer updates", async () => {
    const expiresAt = Date.parse("2026-09-10T01:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt - 10_000);
    mocks.listPlatformInvites.mockResolvedValue([{ ...invitation, expires_at: new Date(expiresAt).toISOString() }]);
    render(<PlatformInviteManager />);
    const resend = await screen.findByRole("button", { name: "Resend" });
    expect(resend).toBeEnabled();
    clock.mockReturnValue(expiresAt);
    fireEvent.click(resend);
    expect(mocks.resendPlatformInvite).not.toHaveBeenCalled();
    expect(resend).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeEnabled();
  });

  it("keeps load errors distinct from empty results and suppresses provider diagnostics", async () => {
    mocks.listPlatformInvites.mockRejectedValueOnce(new Error("private provider detail"));
    render(<I18nProvider initialLocale="es"><PlatformInviteManager /></I18nProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las invitaciones.");
    expect(screen.queryByText("private provider detail")).toBeNull();
    expect(screen.queryByText("Todavía no hay invitaciones.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Todavía no hay invitaciones.")).toBeInTheDocument();
  });

  it("offers two explicit waiver commands without claiming the current payment status", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mocks.setActivationWaiver.mockResolvedValue(undefined);
    render(<RoleManager />);
    const waive = await screen.findByRole("button", { name: "Waive activation fee" });
    fireEvent.click(waive);
    expect(mocks.setActivationWaiver).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(waive);
    await screen.findByText("Activation fee waiver saved. Verification, terms and payment records are unchanged.");
    expect(mocks.setActivationWaiver).toHaveBeenLastCalledWith("user-1", true);
    fireEvent.click(screen.getByRole("button", { name: "Require activation fee" }));
    await screen.findByText("Activation fee waiver removed. Any existing payment remains valid. No charge was made.");
    expect(mocks.setActivationWaiver).toHaveBeenLastCalledWith("user-1", false);
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("Any existing payment remains valid"));
    expect(mocks.setUserRoles).not.toHaveBeenCalled();
  });
});
