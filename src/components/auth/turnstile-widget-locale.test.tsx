import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function ChangeLanguage() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("en")}>Change language</button>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("translates a real widget script failure without reloading or issuing a token", async () => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-public-site-key");
  const { TurnstileWidget } = await import("@/components/auth/turnstile-widget");
  const onToken = vi.fn();
  const scripts: HTMLScriptElement[] = [];
  const appendChild = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    if (node instanceof HTMLScriptElement && node.src === "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit") {
      scripts.push(node);
      // Fail only the external transport; keep the widget's own error handler.
      queueMicrotask(() => node.dispatchEvent(new Event("error")));
      return node;
    }
    return appendChild(node);
  });

  // Shipped dictionaries are intentional: the parent must integrate the fragment.
  render(
    <I18nProvider initialLocale="es">
      <ChangeLanguage />
      <TurnstileWidget onToken={onToken} />
    </I18nProvider>,
  );

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveAttribute("aria-live", "assertive");
  expect(alert.textContent).toBe("No se pudo cargar la verificación de seguridad, por lo que el inicio de sesión está bloqueado. Desactiva cualquier bloqueador de anuncios para este sitio o cambia de red y luego vuelve a cargar la página.");
  expect(scripts).toHaveLength(1);
  expect(onToken).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Change language" }));
  expect(screen.getByRole("alert")).toBe(alert);
  expect(alert.textContent).toBe("The security check could not load, so sign-in is blocked. Turn off any ad blocker for this site or switch networks, then reload the page.");
  expect(scripts).toHaveLength(1);
  expect(onToken).not.toHaveBeenCalled();
});
