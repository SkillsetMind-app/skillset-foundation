import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountControlDialog } from "@/components/admin/account-control-dialog";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/data/account-controls", () => ({ getAccountControl: mocks.get, setAccountControl: mocks.set }));
const active = { suspended: false, blockedEmail: null, isSelf: false };
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

function Language() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Spanish</button>;
}
function mount(locale: "en" | "es" = "en") {
  const onClose = vi.fn();
  render(<I18nProvider initialLocale={locale}><Language /><AccountControlDialog uid="user-2" label="person@example.test" onClose={onClose} /></I18nProvider>);
  return onClose;
}

beforeEach(() => {
  mocks.get.mockResolvedValue(active);
  mocks.set.mockResolvedValue({ suspended: true, blockedEmail: "person@example.test", isSelf: false });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("AccountControlDialog", () => {
  it.each(["en", "es"] as const)("requires a reason and explicit confirmation in %s", async locale => {
    const t = (key: string) => translate(getDictionary(locale), `accountControls.${key}`);
    mount(locale);
    await screen.findByText(t("active"));
    expect(screen.getByRole("dialog", { name: t("title") })).toHaveClass("modal-panel", "modal-panel-scroll");
    const confirm = screen.getByRole("button", { name: t("confirm") });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: t("block") }));
    fireEvent.change(screen.getByRole("textbox", { name: t("reason") }), { target: { value: "   " } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: t("reason") }), { target: { value: "Documented operational reason" } });
    expect(mocks.set).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1));
    expect(mocks.set).toHaveBeenCalledWith("user-2", "block", "Documented operational reason");
    expect(await screen.findByText(t("saved"))).toBeVisible();
    expect(screen.getByText(t("suspended"))).toBeVisible();
  });

  it("restores with the old-session warning and never performs a write on open", async () => {
    mocks.get.mockResolvedValue({ suspended: true, blockedEmail: "person@example.test", isSelf: false });
    mount();
    expect(await screen.findByRole("radio", { name: "Restore access and email registration" })).toBeChecked();
    expect(screen.getByText(/old sessions remain invalid/)).toBeVisible();
    expect(mocks.set).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Reason (required)" }), { target: { value: "Reviewed restriction" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm account change" }));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith("user-2", "restore", "Reviewed restriction"));
  });

  it("does not offer a self-lockout", async () => {
    mocks.get.mockResolvedValue({ ...active, isSelf: true });
    mount();
    expect(await screen.findByText("You cannot change your own account access.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm account change" })).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("keeps pending changes bound to the target and blocks duplicate submits and Escape", async () => {
    let finish!: (value: typeof active) => void;
    mocks.set.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const onClose = mount();
    await screen.findByText("Access enabled");
    const reason = screen.getByRole("textbox");
    fireEvent.change(reason, { target: { value: "Documented reason" } });
    fireEvent.submit(reason.closest("form")!);
    fireEvent.submit(reason.closest("form")!);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(reason).toBeDisabled();
    const cancel = new Event("cancel", { bubbles: false, cancelable: true });
    fireEvent(screen.getByRole("dialog"), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Spanish" }));
    await act(async () => { finish(active); });
    expect(await screen.findByText(translate(getDictionary("es"), "accountControls.saved"))).toBeVisible();
  });

  it("hides provider diagnostics and keeps the reason when a write fails", async () => {
    mocks.set.mockRejectedValue({ message: "private provider details" });
    mount();
    await screen.findByText("Access enabled");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Documented reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm account change" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("private provider");
    expect(screen.getByRole("textbox")).toHaveValue("Documented reason");
    expect(screen.queryByText("Account change saved and recorded in the audit log.")).not.toBeInTheDocument();
  });

  it("cannot act when status/MFA is unavailable, and retry only reads", async () => {
    mocks.get.mockRejectedValueOnce({ message: "ACCOUNT_CONTROL_ADMIN_MFA_REQUIRED" });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("two-factor authentication");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: translate(getDictionary("en"), "authFlow.loading.retry") }));
    await screen.findByText("Access enabled");
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
