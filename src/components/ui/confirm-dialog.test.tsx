import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIRM_GUARD_MS, ConfirmDialog } from "@/components/ui/confirm-dialog";

// jsdom does not implement showModal/close: the stub does the minimum the browser
// does (the open attribute and the close event), as in account-control-dialog.test.
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

beforeEach(() => {
  // Only the clock (Date) is fake: the double-tap guard reads Date.now(), and the
  // real setTimeout calls keep serving findBy/waitFor.
  vi.useFakeTimers({ toFake: ["Date"] });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function Harness({ onConfirm, errorLabel }: { onConfirm: () => unknown; errorLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open ? (
        <ConfirmDialog
          eyebrow="Danger zone"
          title="Delete it?"
          confirmLabel="Yes, delete"
          pendingLabel="Deleting…"
          cancelLabel="Keep it"
          danger
          onConfirm={onConfirm}
          errorLabel={errorLabel}
          onClose={() => setOpen(false)}
        >
          This cannot be undone.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function openDialog(onConfirm: () => unknown = vi.fn(), errorLabel?: string) {
  render(<Harness onConfirm={onConfirm} errorLabel={errorLabel} />);
  const trigger = screen.getByRole("button", { name: "Open" });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole("dialog", { name: "Delete it?" }) };
}

describe("ConfirmDialog", () => {
  it("opens as a modal, fits on the screen, describes the consequence and starts on the safe side", () => {
    const { dialog } = openDialog();
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveClass("modal-panel", "modal-panel-scroll");
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Yes, delete" })).toHaveClass("button-danger", "button-danger-solid");
  });

  // The standard footer stacks below sm with column-reverse: the last one in the
  // code ends up on top. Cancel comes first, so on phones it sits
  // at the bottom, where the thumb lands; from sm up, to the left of confirm.
  it("in the standard footer Cancel comes before confirm (at the bottom when stacked)", () => {
    const { dialog } = openDialog();
    const keep = within(dialog).getByRole("button", { name: "Keep it" });
    const remove = within(dialog).getByRole("button", { name: "Yes, delete" });
    expect(dialog).toHaveClass("dialog-panel");
    expect(keep.parentElement).toHaveClass("dialog-footer");
    expect(remove.parentElement).toBe(keep.parentElement);
    expect(Array.from(keep.parentElement!.children)).toEqual([keep, remove]);
    expect(keep).toHaveFocus();
  });

  it("cancel and Esc close without confirming and return focus to the trigger", () => {
    const onConfirm = vi.fn();
    const { trigger } = openDialog(onConfirm);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms only once, locks during the request and closes when it finishes", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    openDialog(onConfirm);
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    const confirm = screen.getByRole("button", { name: "Yes, delete" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeDisabled();

    // Esc in the middle of the request does not close it.
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => finish());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // Confirm used to swap its label for the waiting one and grow; now both live
  // in the same cell (the Button's busyLabel) and the name is always the visible one.
  it("confirm holds both labels: the name is the resting one and, when busy, the waiting one", async () => {
    let finish!: () => void;
    openDialog(vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })));
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    const confirm = screen.getByRole("button", { name: "Yes, delete" });
    expect(confirm).toHaveTextContent("Deleting…");
    expect(confirm).not.toHaveAttribute("aria-busy");

    fireEvent.click(confirm);
    expect(confirm).toHaveAccessibleName("Deleting…");
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm).toHaveTextContent("Yes, delete");

    await act(async () => finish());
  });

  // On phones confirm takes the full width right below the center: on a double
  // tap on "Delete account", the 2nd tap would land on it.
  it("ignores confirm right after opening and accepts it after the guard", () => {
    const onConfirm = vi.fn();
    openDialog(onConfirm);
    const confirm = screen.getByRole("button", { name: "Yes, delete" });

    fireEvent.click(confirm);
    vi.advanceTimersByTime(CONFIRM_GUARD_MS - 1);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    // The guard does not disable the button: it only discards the click.
    expect(confirm).toBeEnabled();
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();

    vi.advanceTimersByTime(1);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("if onConfirm rejects, it stays open, unlocks and warns; a new attempt closes it", async () => {
    const onConfirm = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    openDialog(onConfirm);
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);

    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't go through. Try again in a moment.");
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Yes, delete" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  // Notice with no choice (it was window.alert): a single button, no red, that
  // closes on the first tap; acknowledging undoes nothing.
  it("acknowledge: a single button, with focus, with no double-tap guard", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog acknowledge danger title="Upload in progress" confirmLabel="OK, I'll wait" onConfirm={onConfirm} onClose={onClose}>
        Wait for it to finish.
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Upload in progress" });
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    const ok = within(dialog).getByRole("button", { name: "OK, I'll wait" });
    expect(ok).toHaveFocus();
    expect(ok).not.toHaveClass("button-danger-solid");

    // Without advancing the clock: the first tap already counts.
    fireEvent.click(ok);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("acknowledge: Esc also closes", () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog acknowledge title="Upload in progress" confirmLabel="OK" onConfirm={vi.fn()} onClose={onClose}>
        Wait.
      </ConfirmDialog>,
    );
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the caller's errorLabel in place of the generic sentence", async () => {
    openDialog(vi.fn().mockRejectedValue(new Error("network")), "Could not delete it.");
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete it.");
  });
});
