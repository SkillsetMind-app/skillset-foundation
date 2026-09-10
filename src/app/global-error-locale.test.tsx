import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import GlobalError from "./global-error";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

vi.mock("@/lib/posthog/client", () => ({ captureException: vi.fn() }));
afterEach(() => { cleanup(); document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0`; });

// Keep this the only client render in the file. React marks the document as
// "listening" the first time any root mounts in it; a later root created on
// `document` itself then skips its click listeners, so the reset button looks
// dead only inside the test (Next hydrates the document exactly once).
it("uses the explicit Spanish cookie for client crash recovery without an I18nProvider", () => {
  document.cookie = `${LOCALE_COOKIE}=es; path=/`;
  const reset = vi.fn();
  render(<GlobalError error={new Error("private")} reset={reset} />, { container: document });
  expect(screen.getByRole("heading", { name: "La aplicación encontró un error inesperado." })).toBeTruthy();
  expect(document.documentElement.lang).toBe("es");
  fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
  expect(reset).toHaveBeenCalledOnce();
  expect(screen.queryByText("private")).toBeNull();
});
