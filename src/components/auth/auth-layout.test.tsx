import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import UnifiedAuthPage from "@/app/auth/page";
import OnboardingPage from "@/app/onboarding/page";
import WelcomePage from "@/app/welcome/page";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/i18n/server", () => ({
  getServerTranslation: async () => ({ locale: "en", t: (key: string) => translate(getDictionary("en"), key) }),
}));
// Exercise the real Suspense fallback without emulating a complete Next server.
vi.mock("@/components/auth/auth-page", () => ({
  AuthPage: () => { throw new Promise(() => {}); },
}));
vi.mock("@/components/auth/onboarding-choice", () => {
  const pending = new Promise(() => {});
  return { OnboardingChoice: () => { throw pending; } };
});
vi.mock("@/components/auth/onboarding-wizard", () => {
  const pending = new Promise(() => {});
  return { OnboardingWizard: () => { throw pending; } };
});
vi.mock("@/components/auth/turnstile-widget", () => ({ TurnstileWidget: () => null, isCaptchaEnabled: false }));
vi.mock("@/lib/auth/providers", () => ({ isGoogleAuthEnabled: false }));

afterEach(cleanup);

describe("the auth frame stays consistent during recovery and loading", () => {
  it("keeps the recovery heading and email in the first column, ahead of the decorative portrait", async () => {
    const shell = await AuthShell({
      title: "Reset your password.",
      description: "Enter the email on your account.",
      children: <ResetPasswordForm />, footer: <a href="/auth?mode=signin">Return to sign in</a>,
    });
    const { container } = render(<I18nProvider initialLocale="en">{shell}</I18nProvider>);
    const formColumn = container.querySelector(".auth-form-col")!;
    expect(formColumn).toBeInTheDocument();
    expect(within(formColumn as HTMLElement).getByRole("heading", { level: 1, name: "Reset your password." })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to sign in" })).toHaveAttribute("href", "/auth?mode=signin");
    const portrait = container.querySelector(".auth-aside")!;
    expect(portrait).toHaveAttribute("aria-hidden", "true");
    expect(formColumn.compareDocumentPosition(portrait) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("loads in the same frame without disabled mode tabs that disappear after hydration", async () => {
    const page = await UnifiedAuthPage();
    const { container } = render(<I18nProvider initialLocale="en">{page}</I18nProvider>);
    expect(container.querySelector(".auth-form-col")).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
  });

  it("keeps the real onboarding Suspense fallback inside a single page heading", async () => {
    const page = await OnboardingPage();
    // Resolve the server shell while preserving the page's real Suspense child.
    const shell = await AuthShell(page.props);
    render(<I18nProvider initialLocale="en">{shell}</I18nProvider>);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(translate(getDictionary("en"), "auth.onboardingShell.title"));
    expect(screen.getByText("Preparing onboarding")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Preparing onboarding" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("link", { name: translate(getDictionary("en"), "auth.onboardingShell.footerLink") })).toHaveAttribute("href", "/courses");
  });

  it("keeps the full-page welcome fallback as a titled page", () => {
    render(<WelcomePage />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1, name: "Preparing onboarding" })).toBeInTheDocument();
  });

  it("allows a tall form to grow and reserves a narrow column without imposing viewport height on its content", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("\n}", start));
    };
    expect(rule(".auth-split")).toContain("min-height: 100svh");
    expect(rule(".auth-form-col")).toContain("min-width: 0");
    expect(rule(".auth-main")).toContain("flex: 1 0 auto");
    expect(rule(".auth-main")).not.toMatch(/(?:^|\n)\s*(?:height|max-height|overflow):/);
    expect(rule(".auth-card")).toContain("min-width: 0");
  });
});
