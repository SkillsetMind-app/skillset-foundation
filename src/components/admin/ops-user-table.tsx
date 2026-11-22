"use client";

import { Shield } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AccountControlDialog } from "@/components/admin/account-control-dialog";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { Button, Field, InlineAlert } from "@/components/ui";
import {
  OPS_USERS_PAGE_SIZE,
  searchOpsUsers,
  type OpsUserPage,
  type OpsUserRow,
  type OpsUserStatus,
} from "@/lib/data/ops-users";
import type { Role } from "@/lib/permissions";

const copy = "platform.ops.usersPanel";
const table = "platform.ops.userTable";
const STATUSES: readonly OpsUserStatus[] = ["active", "suspended", "blocked"];
const COLUMNS = ["person", "level", "status", "joined", "lastSignIn"] as const;
const ROLES: readonly Role[] = ["student", "teacher", "admin", "support", "moderator", "ops"];
const roleLabelKeys = {
  guest: "platform.ops.usersPanel.roles.guest",
  student: "roles.learner",
  teacher: "platform.ops.accessPanel.levels.teacher.label",
  admin: "roles.admin",
  support: "roles.support",
  moderator: "platform.ops.usersPanel.roles.moderator",
  ops: "platform.crumbs.ops",
} satisfies Record<Role, string>;

type LoadError = "mfaRequired" | "loadError";

function formatDate(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

// Só a recusa conhecida vira texto; diagnóstico do provedor nunca vai para a tela.
function errorKey(caught: unknown): LoadError {
  const message = typeof caught === "object" && caught !== null && "message" in caught ? caught.message : null;
  return message === "OPS_ADMIN_MFA_REQUIRED" ? "mfaRequired" : "loadError";
}

export function OpsUserTable() {
  const { t, locale } = useTranslation();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OpsUserStatus | "">("");
  const [role, setRole] = useState<Role | "">("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<OpsUserPage | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [reload, setReload] = useState(0);
  const [target, setTarget] = useState<OpsUserRow | null>(null);

  useEffect(() => {
    let current = true;
    // Debounce: digitar um nome não dispara uma consulta por tecla.
    const timer = window.setTimeout(() => {
      setError(null);
      searchOpsUsers({ search, status: status || null, role: role || null, page })
        .then((next) => { if (current) setResult(next); })
        .catch((caught) => { if (current) { setResult(null); setError(errorKey(caught)); } });
    }, 300);
    return () => { current = false; window.clearTimeout(timer); };
  }, [search, status, role, page, reload]);

  const total = result?.total ?? 0;
  const from = total === 0 ? 0 : page * OPS_USERS_PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * OPS_USERS_PAGE_SIZE);

  return (
    <section className="min-w-0 rounded-lg border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)] sm:p-6">
      {target ? (
        <AccountControlDialog key={target.uid} uid={target.uid} label={target.email || target.displayName || target.uid}
          onClose={() => { setTarget(null); setReload((value) => value + 1); }} />
      ) : null}
      <h3 className="text-base font-semibold text-[var(--color-ink)]">{t(`${copy}.title`)}</h3>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">{t(`${copy}.description`)}</p>

      <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_minmax(0,10rem)]">
        <Field id="ops-user-search" label={t(`${table}.searchLabel`)}>
          {(a11y) => <input {...a11y} type="search" value={search} placeholder={t(`${table}.searchPlaceholder`)}
            onChange={(event) => { setSearch(event.target.value); setPage(0); }}
            className="min-h-11 w-full rounded-md border border-[var(--color-line)] px-4 py-2.5 text-sm font-normal" />}
        </Field>
        <Field id="ops-user-status" label={t(`${table}.statusLabel`)}>
          {(a11y) => <select {...a11y} value={status}
            onChange={(event) => { setStatus(event.target.value as OpsUserStatus | ""); setPage(0); }}
            className="min-h-11 w-full rounded-md border border-[var(--color-line)] bg-transparent px-3 text-sm">
            <option value="">{t(`${table}.all`)}</option>
            {STATUSES.map((value) => <option key={value} value={value}>{t(`${table}.status.${value}`)}</option>)}
          </select>}
        </Field>
        <Field id="ops-user-role" label={t(`${table}.roleLabel`)}>
          {(a11y) => <select {...a11y} value={role}
            onChange={(event) => { setRole(event.target.value as Role | ""); setPage(0); }}
            className="min-h-11 w-full rounded-md border border-[var(--color-line)] bg-transparent px-3 text-sm">
            <option value="">{t(`${table}.all`)}</option>
            {ROLES.map((value) => <option key={value} value={value}>{t(roleLabelKeys[value])}</option>)}
          </select>}
        </Field>
      </div>

      {error ? (
        <InlineAlert tone="error" className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <span>{t(error === "mfaRequired" ? `${table}.mfaRequired` : `${copy}.loadError`)}</span>
          {error === "mfaRequired" ? (
            <Link href="/account/security" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
              {t(`${table}.setUpMfa`)}
            </Link>
          ) : (
            <Button variant="outline" className="min-h-11" onClick={() => setReload((value) => value + 1)}>
              {t("authFlow.loading.retry")}
            </Button>
          )}
        </InlineAlert>
      ) : null}

      {!result && !error ? <p role="status" className="mt-6 text-sm text-[var(--color-ink-soft)]">{t(`${copy}.loading`)}</p> : null}
      {result && result.users.length === 0 ? <p className="mt-6 text-sm text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p> : null}

      {result && result.users.length > 0 ? (
        // Tabela no lugar de 50 cartões altos (~9.400px): datas em coluna, dez
        // linhas por tela. Rola de lado dentro do próprio quadro no celular (I-01).
        <div role="region" aria-label={t(`${copy}.title`)} tabIndex={0} className="mt-5 min-w-0 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b fine-rule">
                {COLUMNS.map((column) => (
                  <th key={column} scope="col" className="py-2 pr-4 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    {t(`${table}.columns.${column}`)}
                  </th>
                ))}
                <th scope="col" className="py-2"><span className="sr-only">{t(`${table}.columns.actions`)}</span></th>
              </tr>
            </thead>
            <tbody>
              {result.users.map((user) => (
                <tr key={user.uid} className="border-b fine-rule last:border-b-0">
                  <td className="py-2 pr-4">
                    <Link href={`/ops/users/${encodeURIComponent(user.uid)}`}
                      className="inline-flex min-h-11 items-center break-words font-semibold text-[var(--color-ink)] underline underline-offset-4">
                      {user.displayName || t(`${copy}.unnamed`)}
                    </Link>
                    <span className="block break-all text-xs text-[var(--color-ink-soft)]">{user.email || t(`${copy}.noEmail`)}</span>
                  </td>
                  <td className="py-2 pr-4 text-[var(--color-ink)]">{user.roles.map((entry) => t(roleLabelKeys[entry])).join(", ")}</td>
                  <td className="py-2 pr-4"><StatusChip status={user.status} label={t(`${table}.status.${user.status}`)} /></td>
                  <td className="py-2 pr-4 text-xs tabular-nums text-[var(--color-ink-soft)]">{formatDate(user.createdAt, locale) ?? "—"}</td>
                  <td className="py-2 pr-4 text-xs tabular-nums text-[var(--color-ink-soft)]">
                    {formatDate(user.lastSignInAt, locale) ?? t(`${table}.neverSignedIn`)}
                  </td>
                  <td className="py-2 text-right">
                    <Button variant="outline" size="sm" className="min-h-11 px-3 whitespace-nowrap" onClick={() => setTarget(user)}
                      icon={<Shield size={16} className="shrink-0" aria-hidden />}>
                      {t("accountControls.title")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {result && total > 0 ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--color-ink-soft)]">
            {t(`${table}.range`).replace("{from}", () => String(from)).replace("{to}", () => String(to)).replace("{total}", () => String(total))}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
              {t(`${table}.previous`)}
            </Button>
            <Button variant="outline" className="min-h-11" disabled={to >= total} onClick={() => setPage((value) => value + 1)}>
              {t(`${table}.next`)}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
