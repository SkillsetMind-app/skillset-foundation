import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "@/components/auth/auth-provider";
import { OnboardingChoice } from "@/components/auth/onboarding-choice";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { currentPrivacyVersion, currentTermsVersion } from "@/lib/legal/versions";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams("path=teacher"),
  getClient: vi.fn(),
  getUser: vi.fn(),
  assurance: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.params,
  usePathname: () => "/onboarding",
}));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ locale: "en", t: (key: string) => key }),
}));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: mocks.getClient }));
vi.mock("@/lib/posthog/client", () => ({ identifyUser: vi.fn(), resetUser: vi.fn() }));
vi.mock("@/lib/attribution/first-touch", () => ({ captureFirstTouch: vi.fn(), getFirstTouch: () => ({}) }));
vi.mock("@/components/auth/turnstile-widget", () => ({ isCaptchaEnabled: false, TurnstileWidget: () => null }));

const authUser = {
  id: "learner-1", email: "educator@example.test", email_confirmed_at: "2026-01-01",
  user_metadata: { name: "Demo Educator" },
};
type Row = Record<string, unknown>;
let row: Row;
let events: string[];
let readFailure: boolean;
let writeFailure: boolean;
let handlers: Set<(event: string, session: unknown) => void>;

// Mapeadores, gravacoes de perfil e sessao reais usam este transporte filtrado.
function usersQuery() {
  let uid: unknown;
  let patch: Row | undefined;
  const execute = async () => {
    if (uid !== row.uid) return { data: null, error: null };
    if (patch) {
      if (writeFailure) return { data: null, error: new Error("private write failure") };
      Object.assign(row, patch);
      events.push(patch.roles ? "persist-roles" : "persist-answers");
      return { data: null, error: null };
    }
    events.push("read-profile");
    return readFailure
      ? { data: null, error: new Error("private profile failure") }
      : { data: { ...row }, error: null };
  };
  return {
    select() { return this; },
    eq(column: string, value: unknown) {
      if (column !== "uid") throw new Error("Unexpected profile filter");
      uid = value;
      return this;
    },
    update(values: Row) { patch = values; return this; },
    maybeSingle: execute,
    then(resolve: (value: Awaited<ReturnType<typeof execute>>) => unknown, reject: (error: unknown) => unknown) {
      return execute().then(resolve, reject);
    },
  };
}

function SessionProbe() {
  const { status, user } = useAuth();
  return <output data-testid="session">{status}:{user?.roles.join(",") ?? "none"}</output>;
}

async function mount() {
  render(<AuthProvider>
    <SessionProbe />
    <OnboardingChoice />
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <p>Teacher workspace</p>
    </ProtectedSurface>
  </AuthProvider>);
  await act(async () => {
    for (const handler of handlers) handler("INITIAL_SESSION", { user: authUser });
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.getByTestId("session")).toHaveTextContent("authenticated:student");
  expect(screen.queryByText("Teacher workspace")).not.toBeInTheDocument();
  await screen.findByText("onboarding.streamlinedTitle");
}

function activate() {
  fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
}

describe("onboarding refreshes the real provider before navigation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
    handlers = new Set();
    events = [];
    readFailure = false;
    writeFailure = false;
    row = {
      uid: "learner-1", email: "educator@example.test", display_name: "Demo Educator",
      username: "demo-educator", bio: "", timezone: "America/New_York", photo_url: null,
      goals: ["teach_online"], roles: ["student"], onboarding_completed: true,
      onboarding_path: "student", onboarding_answers: { payoutCountry: "US" },
      teacher_terms_accepted_at: "2026-01-01", terms_version: currentTermsVersion,
      privacy_version: currentPrivacyVersion,
    };
    mocks.fetch.mockRejectedValue(new Error("Network forbidden"));
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.getUser.mockImplementation(async () => {
      events.push("refresh-user");
      return { data: { user: authUser }, error: null };
    });
    mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
    mocks.router.push.mockImplementation(() => { events.push("navigate"); });
    mocks.getClient.mockReturnValue({
      from: (table: string) => {
        if (table !== "users") throw new Error("Unexpected table");
        return usersQuery();
      },
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      auth: {
        getUser: mocks.getUser,
        mfa: { getAuthenticatorAssuranceLevel: mocks.assurance },
        onAuthStateChange: (handler: (event: string, session: unknown) => void) => {
          handlers.add(handler);
          return { data: { subscription: { unsubscribe: () => handlers.delete(handler) } } };
        },
      },
    });
  });
  afterEach(() => {
    cleanup();
    expect(mocks.fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("persists teacher, waits for refresh, and opens the protected workspace without a new auth event", async () => {
    await mount();
    let resolveUser!: (value: { data: { user: typeof authUser }; error: null }) => void;
    mocks.getUser.mockImplementationOnce(() => {
      events.push("refresh-user");
      return new Promise((resolve) => { resolveUser = resolve; });
    });
    activate();
    await waitFor(() => expect(row.roles).toEqual(["teacher"]));
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("session")).toHaveTextContent("authenticated:student");
    expect(screen.queryByText("Teacher workspace")).not.toBeInTheDocument();
    await act(async () => resolveUser({ data: { user: authUser }, error: null }));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach"));
    expect(screen.getByTestId("session")).toHaveTextContent("authenticated:teacher");
    expect(screen.getByText("Teacher workspace")).toBeInTheDocument();
    expect(events.indexOf("persist-roles")).toBeLessThan(events.indexOf("refresh-user"));
    expect(events.indexOf("refresh-user")).toBeLessThan(events.indexOf("navigate"));
  });

  it("keeps the form and denies teacher access when the refreshed profile fails, then permits retry", async () => {
    await mount();
    readFailure = true;
    activate();
    await screen.findByText("onboarding.errorFinish");
    expect(row.roles).toEqual(["teacher"]);
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(screen.queryByText("Teacher workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "onboarding.activateTeaching" })).toBeEnabled();
    readFailure = false;
    activate();
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach"));
    expect(screen.getByText("Teacher workspace")).toBeInTheDocument();
  });

  it("does not turn a refreshed MFA-pending session into teacher access", async () => {
    await mount();
    mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    activate();
    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("mfa_required:none"));
    expect(row.roles).toEqual(["teacher"]);
    expect(screen.queryByText("Teacher workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "auth.verify" })).toBeInTheDocument();
  });

  it.each(["TOKEN_REFRESHED", "SIGNED_IN"])("preserves the real onboarding bio inside ProtectedSurface after a %s profile outage", async (event) => {
    row.roles = ["teacher"];
    row.onboarding_completed = false;
    const mounted = render(<AuthProvider>
      <SessionProbe />
      <ProtectedSurface permissions={["teacherStudio.access"]}><OnboardingChoice /></ProtectedSurface>
    </AuthProvider>);
    await act(async () => {
      for (const handler of handlers) handler("INITIAL_SESSION", { user: authUser });
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // O formulario assina depois de o portao abrir; simula o snapshot do SDK.
    await act(async () => {
      for (const handler of handlers) handler("INITIAL_SESSION", { user: authUser });
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(await screen.findByRole("button", { name: "onboarding.continue" }));
    const bio = screen.getByPlaceholderText("onboarding.bioPlaceholder");
    fireEvent.change(bio, { target: { value: "Unsaved educator biography" } });
    readFailure = true;
    await act(async () => {
      for (const handler of handlers) handler(event, { user: authUser });
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId("session")).toHaveTextContent("authenticated:teacher");
    expect(screen.getByPlaceholderText("onboarding.bioPlaceholder")).toBe(bio);
    expect(bio).toHaveValue("Unsaved educator biography");
    expect(mocks.router.push).not.toHaveBeenCalledWith("/login");
    readFailure = false;
    await act(async () => {
      for (const handler of handlers) handler("TOKEN_REFRESHED", { user: authUser });
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(bio).toHaveValue("Unsaved educator biography");
    mounted.unmount();
    expect(handlers.size).toBe(0);
  });

  it("does not refresh or navigate after a failed persistence", async () => {
    await mount();
    writeFailure = true;
    activate();
    await screen.findByText("onboarding.errorFinish");
    expect(row.roles).toEqual(["student"]);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(screen.queryByText("Teacher workspace")).not.toBeInTheDocument();
  });
});
