import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InvitationPage from "@/app/invitations/[id]/page";
import { PlatformInviteAcceptance } from "@/components/auth/platform-invite-acceptance";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { AuthSession } from "@/domain/auth";
import type { PlatformInvite } from "@/domain/platform-invites";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), getMyPlatformInvite: vi.fn(), acceptPlatformInvite: vi.fn(), assign: vi.fn() }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: mocks.useAuth }));
vi.mock("@/lib/data/platform-invites", () => mocks);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const invitation: PlatformInvite = {
  id: "invite-1", email: "recipient@example.com", access_level: "teacher", waive_activation: true,
  created_at: "2026-09-09T00:00:00Z", expires_at: "2099-09-09T00:00:00Z", accepted_at: null, revoked_at: null,
};
const session: AuthSession = {
  status: "authenticated",
  user: { uid: "recipient", email: invitation.email, emailVerified: true, displayName: null, photoURL: null, roles: ["student"] },
};

beforeEach(() => {
  mocks.useAuth.mockReturnValue(session);
  mocks.getMyPlatformInvite.mockResolvedValue(invitation);
  vi.stubGlobal("location", { ...window.location, assign: mocks.assign });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("PlatformInviteAcceptance", () => {
  it("can finish a pending waiver after acceptance even when the original invitation expired", async () => {
    mocks.getMyPlatformInvite.mockResolvedValue({ ...invitation, accepted_at: "2026-09-09T01:00:00Z", expires_at: "2026-01-01T00:00:00Z", activation_pending: true });
    mocks.acceptPlatformInvite.mockResolvedValue({ next_path: "/onboarding?path=teacher" });
    render(<PlatformInviteAcceptance id={invitation.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("/onboarding?path=teacher"));
    expect(mocks.acceptPlatformInvite).toHaveBeenCalledTimes(1);
  });
  it("awaits route params and only reads the invitation on GET", async () => {
    render(await InvitationPage({ params: Promise.resolve({ id: invitation.id }) }));
    expect(await screen.findByText(invitation.email)).toBeInTheDocument();
    expect(mocks.getMyPlatformInvite).toHaveBeenCalledWith(invitation.id);
    expect(mocks.acceptPlatformInvite).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("waits for auth and preserves the invitation on both sign-in and signup links", () => {
    mocks.useAuth.mockReturnValue({ status: "loading", user: null });
    const view = render(<PlatformInviteAcceptance id={invitation.id} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading invitations");
    expect(mocks.getMyPlatformInvite).not.toHaveBeenCalled();
    mocks.useAuth.mockReturnValue({ status: "unauthenticated", user: null });
    view.rerender(<PlatformInviteAcceptance id={invitation.id} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?returnTo=%2Finvitations%2Finvite-1");
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/signup?returnTo=%2Finvitations%2Finvite-1");
    expect(mocks.getMyPlatformInvite).not.toHaveBeenCalled();
  });

  it("does not expose a recipient record or provider error when the protected read refuses", async () => {
    mocks.getMyPlatformInvite.mockRejectedValue(new Error("private recipient detail"));
    render(<I18nProvider initialLocale="es"><PlatformInviteAcceptance id={invitation.id} /></I18nProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("correo verificado del destinatario");
    expect(screen.queryByText(invitation.email)).toBeNull();
    expect(screen.queryByText("private recipient detail")).toBeNull();
    expect(screen.queryByRole("button", { name: "Aceptar invitación" })).toBeNull();
    expect(mocks.acceptPlatformInvite).not.toHaveBeenCalled();
  });

  it.each([
    ["teacher", "/onboarding?path=teacher"], ["admin", "/ops"], ["staff", "/ops"], ["student", "/learn"],
  ] as const)("accepts %s only on click and reloads to %s", async (level, nextPath) => {
    mocks.getMyPlatformInvite.mockResolvedValue({ ...invitation, access_level: level });
    let finish!: (value: { next_path: string }) => void;
    mocks.acceptPlatformInvite.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<PlatformInviteAcceptance id={invitation.id} />);
    const accept = await screen.findByRole("button", { name: "Accept invitation" });
    if (level === "teacher") expect(screen.getByText("Activation fee waived. Terms still apply.")).toBeInTheDocument();
    expect(mocks.acceptPlatformInvite).not.toHaveBeenCalled();
    fireEvent.click(accept);
    expect(accept).toBeDisabled();
    fireEvent.click(accept);
    expect(mocks.acceptPlatformInvite).toHaveBeenCalledTimes(1);
    await act(async () => finish({ next_path: nextPath }));
    expect(mocks.assign).toHaveBeenCalledWith(nextPath);
  });

  it.each(["https://outside.example", "//outside.example", "/ops?redirect=outside", "/teach", "javascript:alert(1)"])("refuses an unexpected destination %s", async nextPath => {
    mocks.acceptPlatformInvite.mockResolvedValue({ next_path: nextPath });
    render(<PlatformInviteAcceptance id={invitation.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not finish accepting this invitation");
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it.each([
    { accepted_at: "2026-09-09T01:00:00Z" }, { revoked_at: "2026-09-09T01:00:00Z" }, { expires_at: "2020-01-01T00:00:00Z" },
  ])("does not offer acceptance for a terminal invitation %j", async fields => {
    mocks.getMyPlatformInvite.mockResolvedValue({ ...invitation, ...fields });
    render(<PlatformInviteAcceptance id={invitation.id} />);
    await screen.findByText(invitation.email);
    expect(screen.queryByRole("button", { name: "Accept invitation" })).toBeNull();
    expect(mocks.acceptPlatformInvite).not.toHaveBeenCalled();
  });

  it("discards an old recipient read when the signed-in account changes", async () => {
    let finish!: (value: PlatformInvite) => void;
    mocks.getMyPlatformInvite.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockRejectedValueOnce(new Error("wrong account"));
    const view = render(<PlatformInviteAcceptance id={invitation.id} />);
    mocks.useAuth.mockReturnValue({ ...session, user: { ...session.user!, uid: "other" } });
    view.rerender(<PlatformInviteAcceptance id={invitation.id} />);
    await screen.findByRole("alert");
    await act(async () => finish(invitation));
    await waitFor(() => expect(screen.queryByText(invitation.email)).toBeNull());
    expect(mocks.acceptPlatformInvite).not.toHaveBeenCalled();
  });

  it("does not navigate a different account when an earlier acceptance finishes", async () => {
    let finish!: (value: { next_path: string }) => void;
    mocks.acceptPlatformInvite.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<PlatformInviteAcceptance id={invitation.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
    mocks.useAuth.mockReturnValue({ status: "unauthenticated", user: null });
    view.rerender(<PlatformInviteAcceptance id={invitation.id} />);
    await act(async () => finish({ next_path: "/onboarding?path=teacher" }));
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});
