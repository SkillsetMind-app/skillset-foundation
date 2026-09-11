"use client";

import { isRole, type Role } from "@/lib/permissions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * A pessoa inteira para o Ops, sempre pelo servidor.
 *
 * As duas funções do banco exigem admin ativo com 2FA e só leem. A lista
 * substitui o `select *` da tabela users que a aba Usuários fazia do
 * navegador; o dossiê junta num JSON o que estava espalhado em quatro abas,
 * mais as respostas do cadastro e o comportamento da pessoa. Sem rota de API
 * na frente, pelo motivo de platform-roles.ts: o portão mora ao lado do dado.
 */

export const OPS_USERS_PAGE_SIZE = 50;

export type OpsUserStatus = "active" | "suspended" | "blocked";

export type OpsUserRow = {
  uid: string;
  email: string | null;
  displayName: string | null;
  roles: readonly Role[];
  createdAt: string | null;
  lastSignInAt: string | null;
  status: OpsUserStatus;
};

export type OpsUserPage = { users: OpsUserRow[]; total: number };

export type OpsUserFilters = {
  search?: string;
  status?: OpsUserStatus | null;
  role?: Role | null;
  page?: number;
};

type SearchRow = {
  uid: string | null;
  email: string | null;
  display_name: string | null;
  roles: unknown;
  created_at: string | null;
  last_sign_in_at: string | null;
  suspended: boolean | null;
  blocked: boolean | null;
  total_count: number | null;
};

// users.roles é jsonb: descarta o que o módulo de permissões não conhece.
function toRoles(value: unknown): readonly Role[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Role => typeof entry === "string" && isRole(entry));
}

// Banido implica suspenso (constraint de account_controls); o mais forte vence.
function toStatus(row: SearchRow): OpsUserStatus {
  if (row.blocked) return "blocked";
  if (row.suspended) return "suspended";
  return "active";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function searchOpsUsers(filters: OpsUserFilters = {}): Promise<OpsUserPage> {
  const page = Math.max(0, Math.floor(filters.page ?? 0));
  const { data, error } = await getSupabaseBrowserClient().rpc("admin_search_users", {
    // Omitido em vez de null: o default do SQL já quer dizer "sem filtro".
    p_search: filters.search?.trim() || undefined,
    p_status: filters.status ?? undefined,
    p_role: filters.role ?? undefined,
    p_limit: OPS_USERS_PAGE_SIZE,
    p_offset: page * OPS_USERS_PAGE_SIZE,
  });

  if (error) throw error;

  const rows = ((data ?? []) as SearchRow[]).filter(
    (row): row is SearchRow & { uid: string } => Boolean(row.uid),
  );

  return {
    users: rows.map((row) => ({
      uid: row.uid,
      email: row.email,
      displayName: row.display_name,
      roles: toRoles(row.roles),
      createdAt: row.created_at,
      lastSignInAt: row.last_sign_in_at,
      status: toStatus(row),
    })),
    // ponytail: página além do fim devolve total 0; a tela nunca pede essa página.
    total: Number(rows[0]?.total_count ?? 0),
  };
}

export type DossierCountMap = Record<string, number>;

export type DossierMoneyGroup = {
  status: string | null;
  currency: string | null;
  n: number;
  amount_minor: number;
  refunded_minor: number;
};

export type DossierTimelineKind =
  | "course_created"
  | "enrolled"
  | "order"
  | "lesson_completed"
  | "post"
  | "comment"
  | "lesson_comment"
  | "message"
  | "ticket";

/** Espelha o JSON de admin_get_user_dossier, com as chaves do SQL. */
export type OpsUserDossier = {
  identity: {
    uid: string;
    email: string | null;
    display_name: string | null;
    username: string | null;
    photo_url: string | null;
    roles: readonly Role[];
    created_at: string | null;
    last_login_at: string | null;
    is_self: boolean;
  };
  onboarding: {
    path: string | null;
    completed: boolean | null;
    completed_at: string | null;
    /** OnboardingAnswers gravado pelo formulário de entrada; valores como a pessoa escolheu. */
    answers: Record<string, unknown>;
    goals: unknown;
    credentials: unknown;
    bio: string | null;
    phone_number: string | null;
    timezone: string | null;
    marketing_consent: boolean | null;
    terms_accepted_at: string | null;
    terms_version: string | null;
    privacy_accepted_at: string | null;
    privacy_version: string | null;
    teacher_terms_accepted_at: string | null;
    teacher_terms_version: string | null;
  };
  access: {
    email_confirmed_at: string | null;
    last_sign_in_at: string | null;
    providers: string[];
    verified_factors: number;
    sessions_since_cutoff: number;
    suspended: boolean;
    blocked_email: string | null;
    sessions_revoked_before: string | null;
  };
  learning: {
    enrollments_by_status: DossierCountMap;
    recent_enrollments: Array<{
      id: string;
      course_id: string | null;
      course_title: string | null;
      status: string | null;
      source: string | null;
      progress_percent: number | null;
      created_at: string | null;
    }>;
    certificates: number;
    course_subscriptions_by_status: DossierCountMap;
  };
  behavior: {
    last_activity_at: string | null;
    lessons_completed: number;
    lessons_opened: number;
    messages_sent: number;
    wishlist: number;
    points: number | null;
    level: number | string | null;
    last_30_days: {
      lessons_completed: number;
      posts: number;
      comments: number;
      lesson_comments: number;
      messages: number;
    };
    advisor: { conversations: number; messages: number; last_used_at: string | null };
  };
  timeline: Array<{ kind: DossierTimelineKind; at: string; label: string | null }>;
  purchases: {
    orders: DossierMoneyGroup[];
    recent_orders: Array<{
      id: string;
      course_title: string | null;
      status: string | null;
      amount_minor: number | null;
      currency: string | null;
      refunded_amount_minor: number | null;
      created_at: string | null;
    }>;
    plan_subscription: {
      plan_id: string | null;
      status: string | null;
      current_period_end: string | null;
      cancel_at_period_end: boolean | null;
    } | null;
    stripe_customer_id: string | null;
  };
  creator: {
    verification_status: string | null;
    verification_case: {
      status: string | null;
      kind: string | null;
      profession: string | null;
      registration_type: string | null;
      registration_region: string | null;
      registration_id: string | null;
      evidence_links: unknown;
      note: string | null;
      has_document: boolean;
      created_at: string | null;
      reviewed_at: string | null;
      review_note: string | null;
    } | null;
    activation_fee_paid_at: string | null;
    activation_waiver: { granted_at: string; ready_at: string | null } | null;
    connect: {
      account_id: string | null;
      status: string | null;
      charges_enabled: boolean | null;
      payouts_enabled: boolean | null;
    };
    courses_by_status: DossierCountMap;
    courses: Array<{
      id: string;
      title: string | null;
      slug: string | null;
      status: string | null;
      enrollment_count: number | null;
    }>;
    sales: DossierMoneyGroup[];
  };
  community: {
    posts: number;
    comments: number;
    lesson_comments: number;
    reports_filed: number;
    reports_against_by_status: DossierCountMap;
  };
  support: {
    tickets_by_status: DossierCountMap;
    recent_tickets: Array<{ id: string; subject: string | null; status: string | null; created_at: string | null }>;
  };
  privacy_requests: Array<{
    id: string;
    type: string | null;
    status: string | null;
    requested_at: string | null;
    resolved_at: string | null;
  }>;
  audit: {
    on_user: Array<{
      id: string;
      action: string | null;
      summary: string | null;
      actor_email: string | null;
      reason: string | null;
      created_at: string | null;
    }>;
    by_user: Array<{
      id: string;
      action: string | null;
      summary: string | null;
      target_type: string | null;
      target_id: string | null;
      created_at: string | null;
    }>;
  };
};

export async function getOpsUserDossier(uid: string): Promise<OpsUserDossier> {
  const { data, error } = await getSupabaseBrowserClient().rpc("admin_get_user_dossier", { p_uid: uid });
  if (error) throw error;
  return parseDossier(data);
}

// O SQL monta todo bloco com coalesce; isto só recusa uma resposta que
// quebraria a página (função errada, resposta truncada) e acerta os dois
// campos que vêm de jsonb livre: as respostas do cadastro e a linha do tempo.
export function parseDossier(value: unknown): OpsUserDossier {
  const dossier = value as OpsUserDossier | null;
  if (!dossier || typeof dossier !== "object" || typeof dossier.identity?.uid !== "string") {
    throw new Error("USER_DOSSIER_MALFORMED");
  }
  const answers = dossier.onboarding?.answers;
  return {
    ...dossier,
    identity: { ...dossier.identity, roles: toRoles(dossier.identity.roles) },
    onboarding: { ...dossier.onboarding, answers: isPlainObject(answers) ? answers : {} },
    timeline: Array.isArray(dossier.timeline) ? dossier.timeline : [],
  };
}
