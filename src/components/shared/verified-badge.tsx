"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { brand } from "@/data/brand";
import type { ProfessionalVerification } from "@/domain/user-profile";
import { cn } from "@/lib/cn";

/**
 * Ao lado da credencial de quem não tem o selo: o texto é o que o próprio
 * professor digitou, e ninguém conferiu. Com o selo, não aparece.
 */
export function SelfReportedTag() {
  const { t } = useTranslation();
  return (
    <span className="ml-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
      {t("verifiedBadge.selfReported")}
    </span>
  );
}

/**
 * O selo em si: quadrado com check. Desenho próprio de propósito — nada do
 * círculo recortado do Instagram nem do BadgeCheck do Lucide. Cores em
 * `.verified-seal` (globals.css), que troca no tema escuro.
 *
 * Com `label` vira imagem com nome acessível (cartões, onde o selo está dentro
 * de um link e não pode ser botão); sem, é decorativo.
 */
export function VerifiedSeal({
  size = 16,
  label,
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      focusable="false"
      data-verified-seal=""
      className={cn("verified-seal shrink-0", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <rect width="16" height="16" fill="var(--seal-ground)" />
      <path
        d="M4.2 8.3 6.9 11l4.9-5.6"
        fill="none"
        stroke="var(--seal-mark)"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}

/**
 * O selo com as palavras ao lado: o botão do perfil e a prévia da oferta.
 * Tamanho e peso da letra ficam no <span> de dentro (`verifiedLabelTextClass`):
 * a regra fora de camada `button { font: inherit }` do globals.css vence
 * qualquer utilitária de fonte posta no próprio <button>.
 */
export const verifiedLabelClass =
  "inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-none border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 uppercase tracking-[0.14em] text-[var(--color-accent-fg)]";
export const verifiedLabelTextClass = "text-[11px] font-bold leading-none";

/** Frase do popover: o que foi conferido, e quando (data no idioma da página). */
export function verificationStatement(
  verification: ProfessionalVerification,
  t: (key: string) => string,
  locale: string,
): string {
  const license = verification.kind === "license";
  const date = verification.verifiedAt ? new Date(verification.verifiedAt) : null;
  const dated = date !== null && !Number.isNaN(date.getTime());
  const key = license
    ? dated ? "verifiedBadge.licenseChecked" : "verifiedBadge.licenseCheckedUndated"
    : dated ? "verifiedBadge.evidenceReviewed" : "verifiedBadge.evidenceReviewedUndated";
  return t(key)
    .replace("{brand}", () => brand.name)
    // UTC: o mesmo dia no servidor e no navegador, em qualquer fuso.
    .replace("{date}", () =>
      dated ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date) : "",
    );
}

/**
 * "Profissional verificado": o selo e, ao lado do nome no perfil, as palavras.
 * `compact` mostra só o selo (com nome acessível) onde falta espaço.
 *
 * Abre no clique, no toque e no foco do teclado (celular não tem hover); Esc,
 * clique fora ou foco saindo fecham. O texto diz literalmente o que foi
 * conferido e quando — nunca "certificado", nunca o número de registro.
 * Cosmético: nada aqui ordena, filtra ou destaca ninguém.
 */
export function VerifiedBadge({
  verification,
  compact = false,
  className,
}: {
  verification: ProfessionalVerification;
  compact?: boolean;
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  // Foco que veio de ponteiro (ou que nós mesmos devolvemos) não abre: quem
  // abre nesse caso é o clique, senão o toque abriria e fecharia na hora.
  const pointerFocus = useRef(false);
  const label = t("verifiedBadge.label");

  // Nada fora da tela (AGENTS.md §1): o painel nasce centrado no selo e anda
  // para dentro se passar de alguma borda.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const rect = panel.getBoundingClientRect();
    const width = document.documentElement.clientWidth || window.innerWidth;
    const gutter = 8;
    const shift = rect.left < gutter
      ? gutter - rect.left
      : rect.right > width - gutter ? width - gutter - rect.right : 0;
    panel.style.transform = `translateX(calc(-50% + ${shift}px))`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    setOpen(false);
    pointerFocus.current = true;
    buttonRef.current?.focus();
    pointerFocus.current = false;
  }

  // Foco que sai para outro elemento fecha. Sem relatedTarget (clique no texto
  // do painel, troca de janela) fica aberto; o clique fora fecha pelo efeito.
  function onBlur(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && !rootRef.current?.contains(next)) {
      setOpen(false);
      pointerFocus.current = false;
    }
  }

  return (
    <span ref={rootRef} className={cn("relative inline-flex", className)} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={compact ? label : undefined}
        onPointerDown={() => {
          pointerFocus.current = true;
        }}
        onFocus={() => {
          if (!pointerFocus.current) setOpen(true);
        }}
        onClick={() => {
          // Toque e mouse alternam; Enter/Espaço de quem já abriu pelo foco
          // não fecham por engano (Esc fecha).
          setOpen(pointerFocus.current ? !open : true);
          pointerFocus.current = false;
        }}
        className={
          compact
            ? "grid size-7 place-items-center rounded-none"
            : cn(verifiedLabelClass, "transition-colors duration-[var(--duration-fast)] hover:border-[var(--color-accent)]")
        }
      >
        <VerifiedSeal size={compact ? 16 : 14} />
        {compact ? null : <span className={verifiedLabelTextClass}>{label}</span>}
      </button>

      {open ? (
        <span
          ref={panelRef}
          id={panelId}
          data-verified-popover=""
          style={{ transform: "translateX(-50%)" }}
          className="absolute block left-1/2 top-full z-30 mt-2 w-72 max-w-[calc(100vw-1rem)] border border-[var(--color-line-strong)] border-t-2 border-t-[var(--color-accent)] bg-[var(--color-surface)] p-4 text-left shadow-[var(--shadow-strong)]"
        >
          <span className="flex items-center gap-2 text-sm font-bold text-[var(--color-primary)]">
            <VerifiedSeal size={16} />
            {label}
          </span>
          <span className="mt-2 block text-sm font-normal normal-case leading-6 tracking-normal text-[var(--color-ink)]">
            {verificationStatement(verification, t, locale)}
          </span>
          <span className="mt-2 block text-xs font-normal normal-case leading-5 tracking-normal text-[var(--color-ink-soft)]">
            {t("verifiedBadge.noClaims")}
          </span>
          <Link
            href="/trust"
            className="mt-3 inline-flex min-h-8 items-center text-xs font-semibold normal-case tracking-normal text-[var(--color-primary)] underline underline-offset-4"
          >
            {t("verifiedBadge.trustLink")}
          </Link>
        </span>
      ) : null}
    </span>
  );
}
