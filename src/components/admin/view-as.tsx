"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PeriodTabs } from "@/components/shared/period-tabs";
import type { Role } from "@/lib/permissions";

/**
 * Preview the product as another level.
 *
 * An admin sees admin surfaces everywhere, which makes it impossible to answer
 * "what does a learner actually get" without creating a throwaway account. This
 * swaps the role the INTERFACE reads, so the same session can walk the learner
 * or instructor product and walk back out.
 *
 * It is a preview, not an impersonation: no other account is involved, no data
 * belonging to anyone else is read, and it can only narrow what is on offer.
 * Every write is still gated server-side, which knows nothing about this.
 */

// `role` is what is stored; `roles` is what the interface then sees. Staff are
// granted support + moderator + ops together (staff invitations, the Team
// level in RoleManager), so the Team preview must carry all three.
const PREVIEWABLE: ReadonlyArray<{ role: Role; level: string; roles: readonly Role[] }> = [
  { role: "student", level: "student", roles: ["student"] },
  { role: "teacher", level: "teacher", roles: ["teacher"] },
  { role: "support", level: "staff", roles: ["support", "moderator", "ops"] },
];
const copy = "platform.ops.accessPanel";

/** The role set a stored preview stands for. Still only ever narrows an admin. */
export function previewRoles(role: Role): Role[] {
  return [...(PREVIEWABLE.find((entry) => entry.role === role)?.roles ?? [role])];
}

export function ViewAsSwitcher() {
  const { t } = useTranslation();
  const { isRealAdmin, viewAsRole, setViewAsRole } = useAuth();

  if (!isRealAdmin) {
    return null;
  }

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
      <h3 className="text-base font-semibold text-[var(--color-ink)]">
        {t(`${copy}.preview.title`)}
      </h3>
      <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
        {t(`${copy}.preview.description`)}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Escolhe um modo, não troca de painel: o seletor segmentado único
            (I-18). Sem prévia, nenhum fica pressionado ("" não é opção). */}
        <PeriodTabs<Role | "">
          options={PREVIEWABLE.map((entry) => entry.role)}
          value={viewAsRole ?? ""}
          onChange={(role) => setViewAsRole(role || null)}
          label={t(`${copy}.preview.title`)}
          renderLabel={(role) => {
            const level = PREVIEWABLE.find((entry) => entry.role === role)?.level;
            return t(`${copy}.levels.${level}.label`);
          }}
        />
        {viewAsRole ? (
          <button
            type="button"
            onClick={() => setViewAsRole(null)}
            className="min-h-11 rounded-md border border-[var(--color-line)] px-4 py-2 text-sm font-bold text-[var(--color-ink)]"
          >
            {t(`${copy}.preview.back`)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A faixa é fixa no topo e ficava por cima da barra da plataforma, tampando a
 * busca, o sino e o menu da conta (I-15). Agora ela mede a própria altura e a
 * página desce essa medida (globals.css, `html[data-view-as]`). O observador
 * refaz a medida quando a frase quebra em duas linhas (celular, outro idioma).
 */
function reserveBannerSpace(node: HTMLDivElement | null) {
  if (!node) return;
  const root = document.documentElement;
  const sync = () => root.style.setProperty("--view-as-offset", `${node.offsetHeight}px`);
  sync();
  root.setAttribute("data-view-as", "");
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
  observer?.observe(node);
  return () => {
    observer?.disconnect();
    root.removeAttribute("data-view-as");
    root.style.removeProperty("--view-as-offset");
  };
}

/**
 * Always-on reminder that the product on screen is a preview.
 *
 * Mounted globally, because the preview follows you off the ops page — without
 * this, an admin who wanders into the classroom has no way to tell a missing
 * button from a broken one, and no way back except clearing storage.
 */
export function ViewAsBanner() {
  const { t } = useTranslation();
  const { isRealAdmin, viewAsRole, setViewAsRole } = useAuth();

  if (!isRealAdmin || !viewAsRole) {
    return null;
  }

  const preview = PREVIEWABLE.find((entry) => entry.role === viewAsRole);
  const label = preview ? t(`${copy}.levels.${preview.level}.label`) : viewAsRole;

  return (
    <div
      ref={reserveBannerSpace}
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[70] flex flex-wrap items-center justify-center gap-3 bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-on-primary)]"
    >
      <span>{t(`${copy}.preview.banner`).replace("{role}", () => label)}</span>
      <button
        type="button"
        onClick={() => setViewAsRole(null)}
        className="min-h-11 rounded-md bg-white/15 px-3 py-1 text-xs font-bold underline-offset-2 hover:underline"
      >
        {t(`${copy}.preview.exit`)}
      </button>
    </div>
  );
}
