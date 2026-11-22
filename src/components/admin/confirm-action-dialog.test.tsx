import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(() => {
  // jsdom não tem showModal/close; o mesmo arranjo do teste da janela de conta.
  // Só o Date é falso: o confirmar ignora cliques nos primeiros CONFIRM_GUARD_MS.
  vi.useFakeTimers({ toFake: ["Date"] });
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
    expect(dialog).toHaveAccessibleDescription("It leaves the marketplace now.");
    const confirm = screen.getByRole("button", { name: "Unpublish" });
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // O segundo clique não cai no que está embaixo: a janela continua aberta.
    expect(dialog).toHaveAttribute("open");
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    // Esc enquanto grava não fecha.
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(dialog).toHaveAttribute("open");
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes without running the action on Cancel, and Esc works while idle", () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    const onClose = mount(onConfirm);
    // O foco começa no lado seguro.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const onCloseAgain = mount(onConfirm);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCloseAgain).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores the tap that opened it and still closes when the action fails", async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error("Private write detail")));
    const onClose = mount(onConfirm);
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    expect(onConfirm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    await act(async () => {});
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Quem chamou mostra o erro no painel: a janela só fecha.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
