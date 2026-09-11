import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpsUserDossierPanel } from "@/components/admin/ops-user-dossier";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { OpsUserDossier } from "@/lib/data/ops-users";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/data/ops-users", () => ({ getOpsUserDossier: mocks.get }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/ops/users/u-2",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/components/admin/account-control-dialog", () => ({
  AccountControlDialog: ({ onClose }: { onClose: () => void }) => <button type="button" onClick={onClose}>close control</button>,
}));

const en = (key: string) => translate(getDictionary("en"), key);

function dossier(overrides: Partial<OpsUserDossier> = {}): OpsUserDossier {
  return {
    identity: {
      uid: "u-2", email: "target@example.test", display_name: "Dossier Target", username: null, photo_url: null,
      roles: ["student", "teacher"], created_at: "2026-09-01T00:00:00Z", last_login_at: null, is_self: false,
    },
    onboarding: {
      path: "teacher", completed: true, completed_at: "2026-09-01T00:00:00Z",
      answers: { profession: "Coach", alreadySold: "yes", primaryGoal: ["Business", "Wellness"] },
      goals: null, credentials: null, bio: null, phone_number: "+1 555 0100", timezone: "America/New_York",
      marketing_consent: false, terms_accepted_at: "2026-09-01T00:00:00Z", terms_version: "2026-07",
      privacy_accepted_at: null, privacy_version: null, teacher_terms_accepted_at: null, teacher_terms_version: null,
    },
    access: {
      email_confirmed_at: "2026-09-01T00:00:00Z", last_sign_in_at: null, providers: ["email"], verified_factors: 0,
      sessions_since_cutoff: 1, suspended: true, blocked_email: "target@example.test", sessions_revoked_before: "2026-09-10T00:00:00Z",
    },
    learning: { enrollments_by_status: {}, recent_enrollments: [], certificates: 0, course_subscriptions_by_status: {} },
    behavior: {
      last_activity_at: "2026-09-09T12:00:00Z", lessons_completed: 3, lessons_opened: 5, messages_sent: 1, wishlist: 0,
      points: 40, level: 1,
      last_30_days: { lessons_completed: 2, posts: 1, comments: 0, lesson_comments: 0, messages: 1 },
      advisor: { conversations: 0, messages: 0, last_used_at: null },
    },
    timeline: [{ kind: "course_created", at: "2026-09-02T10:00:00Z", label: "Dossier fixture" }],
    purchases: {
      orders: [{ status: "paid", currency: "USD", n: 2, amount_minor: 9700, refunded_minor: 4850 }],
      recent_orders: [], plan_subscription: null, stripe_customer_id: null,
    },
    creator: {
      verification_status: null, verification_case: null, activation_fee_paid_at: null, activation_waiver: null,
      connect: { account_id: null, status: null, charges_enabled: null, payouts_enabled: null },
      courses_by_status: { draft: 1 },
      courses: [{ id: "c-1", title: "Dossier fixture", slug: "c-1", status: "draft", enrollment_count: 0 }],
      sales: [],
    },
    community: { posts: 0, comments: 0, lesson_comments: 0, reports_filed: 0, reports_against_by_status: {} },
    support: { tickets_by_status: {}, recent_tickets: [] },
    privacy_requests: [{ id: "r-1", type: "account_deletion", status: "pending", requested_at: "2026-09-09T00:00:00Z", resolved_at: null }],
    audit: {
      on_user: [{ id: "a-1", action: "user.account_block", summary: "user.account_block", actor_email: "admin@example.test", reason: "Mass spam", created_at: "2026-09-10T00:00:00Z" }],
      by_user: [],
    },
    ...overrides,
  };
}

function panel(locale: "en" | "es" = "en") {
  return <I18nProvider initialLocale={locale}><OpsUserDossierPanel uid="u-2" /></I18nProvider>;
}

beforeEach(() => mocks.get.mockResolvedValue(dossier()));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("OpsUserDossierPanel", () => {
  it("mostra a pessoa, o status, o dinheiro na moeda certa e o motivo da auditoria", async () => {
    render(panel());
    expect(await screen.findByRole("heading", { name: "Dossier Target" })).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith("u-2");
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    expect(screen.getByText(/\$97\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$48\.50 refunded/)).toBeInTheDocument();
    expect(screen.getByText(/Mass spam/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to users" })).toHaveAttribute("href", "/ops?tab=users");
  });

  it("mostra as respostas do cadastro, o comportamento e a linha do tempo", async () => {
    render(panel());
    await screen.findByRole("heading", { name: "Dossier Target" });
    expect(screen.getByText("Coach")).toBeInTheDocument();
    expect(screen.getByText(en("authFlow.onboarding.alreadySelling"))).toBeInTheDocument();
    expect(screen.getByText("Business, Wellness")).toBeInTheDocument();
    expect(screen.getAllByText("Not answered").length).toBeGreaterThan(0);
    expect(screen.getByText(en("authFlow.onboarding.teacherPath"))).toBeInTheDocument();
    expect(screen.getByText(/2 lessons completed · 1 posts/)).toBeInTheDocument();
    expect(screen.getByText(/Created a course · Dossier fixture/)).toBeInTheDocument();
  });

  it("não oferece o controle de conta na própria conta", async () => {
    mocks.get.mockResolvedValue(dossier({ identity: { ...dossier().identity, is_self: true } }));
    render(panel());
    expect(await screen.findByText("This is your own account.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account access" })).toBeDisabled();
  });

  it("recusa conhecida vira o texto certo; o resto vira erro com nova tentativa, sem vazar o detalhe", async () => {
    mocks.get.mockRejectedValueOnce({ message: "USER_DOSSIER_USER_MISSING" });
    render(panel());
    expect(await screen.findByText("This account no longer exists.")).toBeInTheDocument();
    cleanup();
    mocks.get.mockRejectedValueOnce({ message: "OPS_ADMIN_MFA_REQUIRED" });
    render(panel());
    expect(await screen.findByRole("link", { name: "Set up two-factor authentication" })).toHaveAttribute("href", "/account/security");
    cleanup();
    mocks.get.mockRejectedValueOnce(new Error("provider detail")).mockResolvedValueOnce(dossier());
    render(panel());
    fireEvent.click(await screen.findByRole("button", { name: en("authFlow.loading.retry") }));
    expect(await screen.findByRole("heading", { name: "Dossier Target" })).toBeInTheDocument();
    expect(screen.queryByText("provider detail")).toBeNull();
  });

  it("fechar o controle de conta recarrega o dossiê", async () => {
    render(panel());
    await screen.findByRole("heading", { name: "Dossier Target" });
    fireEvent.click(screen.getByRole("button", { name: "Account access" }));
    fireEvent.click(screen.getByRole("button", { name: "close control" }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  });

  it("fala espanhol", async () => {
    render(panel("es"));
    expect(await screen.findByRole("heading", { name: "Dossier Target" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Respuestas del registro" })).toBeInTheDocument();
    expect(screen.getByText(/Creó un curso · Dossier fixture/)).toBeInTheDocument();
  });

  it("EN e ES têm as mesmas chaves na tabela e no dossiê", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object"
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
        : [prefix];
    type Ops = { platform: { ops: Record<string, unknown> } };
    for (const namespace of ["userTable", "userDossier"]) {
      const enKeys = keys((getDictionary("en") as unknown as Ops).platform.ops[namespace]).sort();
      const esKeys = keys((getDictionary("es") as unknown as Ops).platform.ops[namespace]).sort();
      expect(enKeys.length).toBeGreaterThan(0);
      expect(esKeys).toEqual(enKeys);
    }
  });
});
