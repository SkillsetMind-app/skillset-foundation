import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/auth/login-form";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  signInWithGoogle: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/auth/providers", () => ({ isGoogleAuthEnabled: true }));

vi.mock("@/components/auth/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  isCaptchaEnabled: false,
}));

vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  signInWithEmail: vi.fn(),
  signInWithGoogle: mocks.signInWithGoogle,
}));

vi.mock("@/lib/data/user-profiles", () => ({ getUserProfile: vi.fn() }));

function clickGoogle() {
  fireEvent.click(
    screen.getByRole("button", { name: /auth\.continueWithGoogle/ }),
  );
}

describe("LoginForm with Google", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The real call navigates the browser away and never resolves.
    mocks.signInWithGoogle.mockReturnValue(new Promise(() => {}));
  });

  afterEach(cleanup);

  // The reported bug: the deep link the sign-in wall captured was read here
  // and then never used — Google sign-in always landed on "/".
  it("carries the captured deep link and path into the OAuth round trip", () => {
    mocks.searchParams = new URLSearchParams(
      "path=student&returnTo=%2Flearn%2Fcourses%2Fx",
    );
    render(<LoginForm />);

    clickGoogle();

    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(
      "/loading?next=welcome&path=student&returnTo=%2Flearn%2Fcourses%2Fx",
    );
  });

  it("still routes through /loading when there is no deep link", () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    render(<LoginForm />);

    clickGoogle();

    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(
      "/loading?next=welcome&path=teacher",
    );
  });
});
