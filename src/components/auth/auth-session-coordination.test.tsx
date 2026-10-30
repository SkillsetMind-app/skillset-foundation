import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "@/components/auth/auth-provider";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { currentPrivacyVersion, currentTermsVersion } from "@/lib/legal/versions";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(), getUser: vi.fn(), assurance: vi.fn(), rpc: vi.fn(),
  fetch: vi.fn(), identify: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/teach" }));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: mocks.getClient }));
vi.mock("@/lib/posthog/client", () => ({ identifyUser: mocks.identify, resetUser: vi.fn() }));
vi.mock("@/lib/attribution/first-touch", () => ({ captureFirstTouch: vi.fn() }));

const authUser = { id: "user-1", email: "demo@example.test", email_confirmed_at: "2026-01-01", user_metadata: {} };
const secondUser = { ...authUser, id: "user-2" };
type Row = Record<string, unknown>;
type ReadResult = { data: Row | null; error: Error | null };
type Handler = (event: string, session: unknown) => void;
let handlers: Set<Handler>;
let rows: Map<string, Row>;
let reads: string[];
let nextRead: (() => Promise<ReadResult>) | undefined;
let refreshes: Promise<void>[];
let renderedUsers: unknown[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function holdProfile(uid = "user-1") {
  const pending = deferred<ReadResult>();
  const started = deferred<void>();
  const snapshot = { ...rows.get(uid)! };
  nextRead = () => { started.resolve(); return pending.promise; };
  return { ...pending, started: started.promise, snapshot };
}

// Provider, listener, mapeador e portao reais; apenas o transporte e sintetico.
function usersQuery() {
  let uid = "";
  return {
    select() { return this; },
    eq(column: string, value: string) {
      if (column !== "uid") throw new Error("Unexpected filter");
      uid = value;
      return this;
    },
    async maybeSingle(): Promise<ReadResult> {
      reads.push(uid);
      const pending = nextRead;
      nextRead = undefined;
      if (pending) return pending();
      return { data: rows.has(uid) ? { ...rows.get(uid)! } : null, error: null };
    },
  };
}

function DraftEditor() {
  const { user } = useAuth();
  const [draft, setDraft] = useState(user?.displayName ?? "");
  return <input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} />;
}

function Probe() {
  const { status, user, refreshUser } = useAuth();
  renderedUsers.push(user);
  return <>
    <output data-testid="session">{status}:{user?.uid ?? "none"}:{user?.roles.join(",") ?? "none"}</output>
    <button onClick={() => {
      const refresh = refreshUser();
      refreshes.push(refresh);
      void refresh.catch(() => {});
    }}>Refresh</button>
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <DraftEditor />
    </ProtectedSurface>
  </>;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function fire(event: string, user: typeof authUser | null = authUser) {
  act(() => { for (const handler of handlers) handler(event, user ? { user } : null); });
}

async function mount() {
  const mounted = render(<AuthProvider><Probe /></AuthProvider>);
  fire("INITIAL_SESSION");
  await settle();
  expect(screen.getByTestId("session")).toHaveTextContent("authenticated:user-1:teacher");
  fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), { target: { value: "Unsaved draft" } });
  return mounted;
}

describe("AuthProvider coordinates refreshes and events without losing drafts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
    handlers = new Set();
    reads = [];
    nextRead = undefined;
    refreshes = [];
    renderedUsers = [];
    rows = new Map(["user-1", "user-2"].map((uid) => [uid, {
      uid, email: "demo@example.test", display_name: uid, roles: ["teacher"],
      terms_version: currentTermsVersion, privacy_version: currentPrivacyVersion,
    }]));
    mocks.fetch.mockRejectedValue(new Error("Network forbidden"));
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.getClient.mockReturnValue({
      from: (table: string) => {
        if (table !== "users") throw new Error("Unexpected table");
        return usersQuery();
      },
      rpc: mocks.rpc,
      auth: {
        getUser: mocks.getUser,
        mfa: { getAuthenticatorAssuranceLevel: mocks.assurance },
        onAuthStateChange: (handler: Handler) => {
          handlers.add(handler);
          return { data: { subscription: { unsubscribe: () => handlers.delete(handler) } } };
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    expect(handlers.size).toBe(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each([
    ["TOKEN_REFRESHED", "returned"], ["TOKEN_REFRESHED", "rejected"],
    ["SIGNED_IN", "returned"], ["SIGNED_IN", "rejected"],
  ])("preserves the mounted draft after a %s profile failure: %s", async (event, failure) => {
    await mount();
    const input = screen.getByRole("textbox", { name: "Draft" });
    const user = renderedUsers.at(-1);
    const pending = holdProfile();
    fire(event);
    await pending.started;
    await act(async () => {
      if (failure === "returned") pending.resolve({ data: null, error: new Error("private profile failure") });
      else pending.reject(new Error("private profile failure"));
    });
    await settle();
    expect(screen.getByTestId("session")).toHaveTextContent("authenticated:user-1:teacher");
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
    expect(input).toHaveValue("Unsaved draft");
    fire("TOKEN_REFRESHED");
    fire("SIGNED_IN");
    await settle();
    expect(renderedUsers.at(-1)).toBe(user);
    expect(input).toHaveValue("Unsaved draft");
  });

  it.each(["TOKEN_REFRESHED", "SIGNED_IN"].flatMap((event) =>
    ["pending", "returned", "rejected", "missing", "rpc-returned", "rpc-rejected"].map((failure) => [event, failure]),
  ))("closes an existing session on %s when MFA is not approved: %s", async (event, failure) => {
    await mount();
    const before = reads.length;
    if (failure === "pending") mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    else if (failure === "returned") mocks.assurance.mockResolvedValue({ data: null, error: new Error("private assurance") });
    else if (failure === "rejected") mocks.assurance.mockRejectedValue(new Error("private assurance"));
    else if (failure === "missing") mocks.assurance.mockResolvedValue({ data: null, error: null });
    else {
      mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
      if (failure === "rpc-returned") mocks.rpc.mockResolvedValue({ data: null, error: new Error("private gate") });
      else mocks.rpc.mockRejectedValue(new Error("private gate"));
    }
    fire(event);
    await settle();
    expect(screen.getByTestId("session")).toHaveTextContent(failure === "pending" ? "mfa_required:none:none" : "unauthenticated:none:none");
    expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
    expect(reads).toHaveLength(before);
  });

  it.each(["returned", "rejected"])("closes an existing session when refresh authentication fails: %s", async (failure) => {
    await mount();
    if (failure === "returned") mocks.getUser.mockResolvedValue({ data: { user: authUser }, error: new Error("private auth") });
    else mocks.getUser.mockRejectedValue(new Error("private auth"));
    fireEvent.click(screen.getByText("Refresh"));
    await settle();
    expect(screen.getByTestId("session")).toHaveTextContent("unauthenticated:none:none");
    expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
  });

  it("closes the old user's draft before the new user's delayed profile resolves", async () => {
    await mount();
    const pending = holdProfile("user-2");
    fire("SIGNED_IN", secondUser);
    await pending.started;
    expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
    await act(async () => pending.resolve({ data: pending.snapshot, error: null }));
    await settle();
    expect(screen.getByTestId("session")).toHaveTextContent("authenticated:user-2:teacher");
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("user-2");
  });

  it.each(["returned", "rejected"])("closes the old account and leaves loading when another user's refresh profile fails: %s", async (failure) => {
    await mount();
    mocks.getUser.mockResolvedValue({ data: { user: secondUser }, error: null });
    const pending = holdProfile("user-2");
    fireEvent.click(screen.getByText("Refresh"));
    await pending.started;
    await settle();
    const exposedWhilePending = screen.queryByRole("textbox", { name: "Draft" });
    await act(async () => {
      if (failure === "returned") pending.resolve({ data: null, error: new Error("private new profile failure") });
      else pending.reject(new Error("private new profile failure"));
      await expect(refreshes[0]).rejects.toThrow();
    });
    await settle();
    expect(exposedWhilePending).toBeNull();
    expect(screen.getByTestId("session")).toHaveTextContent("unauthenticated:none:none");
    expect(screen.getByRole("link", { name: "auth.guard.signIn" })).toHaveAttribute("href", "/login?returnTo=%2Fteach");
    expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Refresh"));
    await act(async () => { await refreshes[1]; });
    expect(screen.getByTestId("session")).toHaveTextContent("authenticated:user-2:teacher");
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("user-2");
  });

  it.each(["returned", "rejected"])("initial refresh profile failure leaves loading, rejects and allows recovery: %s", async (failure) => {
    render(<AuthProvider><Probe /></AuthProvider>);
    const pending = holdProfile();
    fireEvent.click(screen.getByText("Refresh"));
    await pending.started;
    expect(screen.getByTestId("session")).toHaveTextContent("loading:none:none");
    await act(async () => {
      if (failure === "returned") pending.resolve({ data: null, error: new Error("private initial profile failure") });
      else pending.reject(new Error("private initial profile failure"));
      await expect(refreshes[0]).rejects.toThrow();
    });
    await settle();
    expect(screen.getByTestId("session")).toHaveTextContent("unauthenticated:none:none");
    expect(screen.getByRole("link", { name: "auth.guard.signIn" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Refresh"));
    await act(async () => { await refreshes[1]; });
    expect(screen.getByTestId("session")).toHaveTextContent("authenticated:user-1:teacher");
  });

  it.each(["returned", "rejected"])("same-user refresh profile failure rejects but preserves the valid session and draft: %s", async (failure) => {
    await mount();
    const input = screen.getByRole("textbox", { name: "Draft" });
    const user = renderedUsers.at(-1);
    const pending = holdProfile();
    fireEvent.click(screen.getByText("Refresh"));
    await pending.started;
    await act(async () => {
      if (failure === "returned") pending.resolve({ data: null, error: new Error("private profile failure") });
      else pending.reject(new Error("private profile failure"));
      await expect(refreshes[0]).rejects.toThrow();
    });
    await settle();
    expect(screen.getByTestId("session")).toHaveTextContent("authenticated:user-1:teacher");
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
    expect(input).toHaveValue("Unsaved draft");
    expect(renderedUsers.at(-1)).toBe(user);
  });

  it.each(["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"])("does not invent a session after an initial %s profile failure", async (event) => {
    render(<AuthProvider><Probe /></AuthProvider>);
    const pending = holdProfile();
    fire(event);
    await pending.started;
    await act(async () => pending.reject(new Error("private initial profile failure")));
    await settle();
    expect(screen.getByTestId("session")).toHaveTextContent("unauthenticated:none:none");
    expect(screen.getByRole("link", { name: "auth.guard.signIn" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
  });

  it.each(["SIGNED_IN", "TOKEN_REFRESHED"])("never preserves the previous account after a different-user %s profile failure", async (event) => {
    await mount();
    const pending = holdProfile("user-2");
    fire(event, secondUser);
    await pending.started;
    await settle();
    expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
    await act(async () => pending.reject(new Error("private different profile failure")));
    await settle();
    expect(screen.getByTestId("session")).toHaveTextContent("unauthenticated:none:none");
    expect(screen.getByRole("link", { name: "auth.guard.signIn" })).toBeInTheDocument();
  });

  it.each(["returned", "rejected"])("explicit refresh also closes access on failed MFA: %s", async (failure) => {
    await mount();
    if (failure === "returned") mocks.assurance.mockResolvedValue({ data: null, error: new Error("private assurance") });
    else mocks.assurance.mockRejectedValue(new Error("private assurance"));
    fireEvent.click(screen.getByText("Refresh"));
    await settle();
    expect(screen.getByTestId("session")).toHaveTextContent("unauthenticated:none:none");
    expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
  });

  it.each(["SIGNED_OUT", "TOKEN_REFRESHED"])("closes immediately on %s without an authenticated user", async (event) => {
    await mount();
    fire(event, null);
    expect(screen.getByTestId("session")).toHaveTextContent("unauthenticated:none:none");
    expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
  });

  it.each(["listener-first", "refresh-first"])("initial student snapshot cannot undo a newer teacher refresh: %s", async (order) => {
    rows.get("user-1")!.roles = ["student"];
    const initial = holdProfile();
    render(<AuthProvider><Probe /></AuthProvider>);
    fire("INITIAL_SESSION");
    await initial.started;
    rows.get("user-1")!.roles = ["teacher"];
    const refreshed = holdProfile();
    fireEvent.click(screen.getByText("Refresh"));
    await refreshed.started;
    const resolveInitial = async () => { await act(async () => initial.resolve({ data: initial.snapshot, error: null })); await settle(); };
    const resolveRefresh = async () => { await act(async () => refreshed.resolve({ data: refreshed.snapshot, error: null })); await settle(); };
    if (order === "listener-first") { await resolveInitial(); await resolveRefresh(); }
    else { await resolveRefresh(); await resolveInitial(); }
    expect(screen.getByTestId("session")).toHaveTextContent("authenticated:user-1:teacher");
    expect(screen.getByRole("textbox", { name: "Draft" })).toBeInTheDocument();
  });

  it.each(["listener-first", "refresh-first"])("newer listener supersedes a pending student refresh: %s", async (order) => {
    await mount();
    rows.get("user-1")!.roles = ["student"];
    const refreshed = holdProfile();
    fireEvent.click(screen.getByText("Refresh"));
    await refreshed.started;
    rows.get("user-1")!.roles = ["teacher"];
    const latest = holdProfile();
    fire("USER_UPDATED");
    await latest.started;
    const resolveListener = async () => { await act(async () => latest.resolve({ data: latest.snapshot, error: null })); await settle(); };
    const resolveRefresh = async () => { await act(async () => refreshed.resolve({ data: refreshed.snapshot, error: null })); await settle(); };
    if (order === "listener-first") { await resolveListener(); await resolveRefresh(); }
    else { await resolveRefresh(); await resolveListener(); }
    expect(screen.getByTestId("session")).toHaveTextContent("authenticated:user-1:teacher");
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("Unsaved draft");
  });

  it.each(["logout", "mfa", "new-user"].flatMap((event) =>
    ["resolve", "reject"].map((outcome) => [event, outcome]),
  ))("a late refresh cannot overwrite a newer %s event: %s", async (event, outcome) => {
    await mount();
    const pending = holdProfile();
    fireEvent.click(screen.getByText("Refresh"));
    await pending.started;
    if (event === "logout") fire("SIGNED_OUT", null);
    else if (event === "mfa") {
      mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
      fire("TOKEN_REFRESHED");
    } else fire("SIGNED_IN", secondUser);
    await settle();
    const before = screen.getByTestId("session").textContent;
    await act(async () => {
      if (outcome === "resolve") pending.resolve({ data: pending.snapshot, error: null });
      else pending.reject(new Error("private stale profile failure"));
      await expect(refreshes[0]).rejects.toThrow();
    });
    await settle();
    expect(screen.getByTestId("session").textContent).toBe(before);
    if (event === "new-user") expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("user-2");
    else expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
  });

  it.each(["old-first", "new-first"])("two explicit refreshes use start order, not completion order: %s", async (order) => {
    await mount();
    rows.get("user-1")!.roles = ["student"];
    const old = holdProfile();
    fireEvent.click(screen.getByText("Refresh"));
    await old.started;
    rows.get("user-1")!.roles = ["teacher"];
    const latest = holdProfile();
    fireEvent.click(screen.getByText("Refresh"));
    await latest.started;
    for (const request of order === "old-first" ? [old, latest] : [latest, old]) {
      await act(async () => request.resolve({ data: request.snapshot, error: null }));
      await settle();
    }
    expect(screen.getByTestId("session")).toHaveTextContent("authenticated:user-1:teacher");
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("Unsaved draft");
  });

  it.each(["resolve", "reject"])("unmount invalidates the pending refresh and listener: %s", async (outcome) => {
    const mounted = await mount();
    const pending = holdProfile();
    fireEvent.click(screen.getByText("Refresh"));
    await pending.started;
    mounted.unmount();
    expect(handlers.size).toBe(0);
    const count = mocks.identify.mock.calls.length;
    await act(async () => {
      if (outcome === "resolve") pending.resolve({ data: pending.snapshot, error: null });
      else pending.reject(new Error("private late profile failure"));
      expect((await Promise.allSettled(refreshes))[0]?.status).toBe("rejected");
    });
    expect(mocks.identify).toHaveBeenCalledTimes(count);
    expect(screen.queryByTestId("session")).not.toBeInTheDocument();
  });

  it("deduplicates an unchanged explicit refresh without resetting the draft or user identity", async () => {
    await mount();
    const user = renderedUsers.at(-1);
    const input = screen.getByRole("textbox", { name: "Draft" });
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(refreshes).toHaveLength(1));
    await act(async () => { await refreshes[0]; });
    expect(renderedUsers.at(-1)).toBe(user);
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
    expect(input).toHaveValue("Unsaved draft");
  });
});
