import { fireEvent, within } from "@testing-library/react";
import { vi } from "vitest";

import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";

// Support for the tests that go through the confirmation dialog (ConfirmDialog).
// jsdom does not implement showModal/close: the stub does the minimum the browser
// does (open attribute and the close event), as in confirm-dialog.test. It returns
// the function that undoes it, so the prototype goes back to what it was in afterEach.
export function stubDialogs() {
  const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
  return () => {
    if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  };
}

// The dialog ignores the confirm in the first CONFIRM_GUARD_MS (double tap):
// the clock advances to there just for this click.
export function clickConfirm(dialog: HTMLElement, name: string | RegExp) {
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + CONFIRM_GUARD_MS);
  try {
    fireEvent.click(within(dialog).getByRole("button", { name }));
  } finally {
    clock.mockRestore();
  }
}
