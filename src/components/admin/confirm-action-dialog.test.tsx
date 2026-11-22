import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { I18nProvider } from "@/components/i18n/i18n-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(() => {
  // jsdom não tem showModal/close; o mesmo arranjo do teste da janela de conta.
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(cleanup);

function mount(onConfirm: () => Promise<unknown>) {
  const onClose = vi.fn();
  render(<I18nProvider initialLocale="en">
    <ConfirmActionDialog title="Unpublish Course?" body="It leaves the marketplace now." confirmLabel="Unpublish"
      onConfirm={onConfirm} onClose={onClose} />
  </I18nProvider>);
  return onClose;
}

describe("ConfirmActionDialog", () => {
  it("runs the action once on a double click and stays open, locked, until it settles", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onClose = mount(onConfirm);
    const dialog = screen.getByRole("dialog", { name: "Unpublish Course?" });
    const confirm = screen.getByRole("button", { name: "Unpublish" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // O segundo clique não cai no que está embaixo: a janela continua aberta.
    expect(dialog).toHaveAttribute("open");
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    const cancel = new Event("cancel", { bubbles: false, cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes without running the action on Cancel, and Esc works while idle", () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    const onClose = mount(onConfirm);
    const cancel = new Event("cancel", { bubbles: false, cancelable: true });
    fireEvent(screen.getByRole("dialog"), cancel);
    expect(cancel.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
