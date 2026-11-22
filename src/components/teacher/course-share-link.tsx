"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { entryUrl, type EntryKind } from "@/domain/host-routing";
import { moveFocusByKey } from "@/lib/a11y/menu-keys";
import { SITE_URL } from "@/lib/seo/page-metadata";
import { useCurrentHostname } from "@/lib/ui/use-current-hostname";

const MENU_ITEM = '[role="menuitem"]';
const actionClass =
  "inline-flex min-h-11 items-center px-4 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

export function CourseShareLink({
  label,
  path,
  title,
  entry,
  copyLabel,
  accent = false,
  focusCopy = false,
  copyDescribedBy,
  compact = false,
}: {
  label: string;
  path: string;
  /** Course title: the text that travels with the URL when shared. */
  title: string;
  /**
   * Short host that publishes this link ("pay" for checkout). Only takes
   * effect in production, where the short hosts resolve; a preview or
   * localhost keeps the link relative so nobody is sent to production from a
   * test environment. Omitted: the canonical www URL, as before.
   */
  entry?: EntryKind;
  /**
   * Texto visível do botão de copiar ("Copy my page link"). Com ele, o nome
   * acessível é o próprio texto, não o aria-label genérico.
   */
  copyLabel?: string;
  /** Latão: só no marco (painel "Publicado!"), no máximo 1 por tela. */
  accent?: boolean;
  /** Leva o foco ao botão de copiar ao montar (marco de publicação). */
  focusCopy?: boolean;
  copyDescribedBy?: string;
  /**
   * Só o botão de copiar, sem a caixa (linha de uma lista de preços). A caixa
   * inteira, com Abrir e Compartilhar, fica em Promo links.
   */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const hostname = useCurrentHostname();
  const url = entry ? entryUrl(entry, path, "", hostname) : `${SITE_URL}${path}`;
  const [result, setResult] = useState<"copied" | "error" | null>(null);
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const forLabel = (key: string) => t(key).replace("{label}", () => label);
  const outlineClass = accent ? "button-outline button-lg" : `button-outline ${actionClass}`;

  useEffect(() => {
    const active = document.activeElement;
    if (focusCopy && (!active || active === document.body)) {
      copyRef.current?.focus();
    }
  }, [focusCopy]);

  // "Copied" mora no próprio botão por 2s e some: antes entrava uma linha nova
  // embaixo que nunca saía, e a caixa crescia.
  useEffect(() => {
    if (result !== "copied") return;
    const timer = window.setTimeout(() => setResult(null), 2000);
    return () => window.clearTimeout(timer);
  }, [result]);

  // Same close rules as the product-list kebab (teacher-course-studio): Escape
  // closes and hands focus back, a press outside the button row closes.
  useEffect(() => {
    if (!open) {
      return;
    }

    // Aberto, o foco vai ao 1º destino e as setas andam entre eles.
    menuRef.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus({ preventScroll: true });

    function handlePointerDown(event: MouseEvent) {
      if (rowRef.current && !rowRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        shareRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function copyLink() {
    setResult(null);
    try {
      await navigator.clipboard.writeText(url);
      setResult("copied");
    } catch {
      setResult("error");
    }
  }

  // The shared message is the course title plus the URL; each network takes it
  // in the shape its intent URL expects. mailto hands off to the mail app, so
  // it is the one target that does not open a new tab.
  const message = encodeURIComponent(`${title} ${url}`);
  const encodedTitle = encodeURIComponent(title);
  const encodedUrl = encodeURIComponent(url);
  const targets = [
    { key: "whatsapp", href: `https://wa.me/?text=${message}` },
    { key: "x", href: `https://x.com/intent/post?text=${encodedTitle}&url=${encodedUrl}` },
    { key: "linkedin", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}` },
    { key: "email", href: `mailto:?subject=${encodedTitle}&body=${message}` },
  ];

  const copied = result === "copied";
  const CopyIcon = copied ? Check : Copy;
  const copyButton = (
    <button
      ref={copyRef}
      type="button"
      onClick={() => void copyLink()}
      // Nome fixo: o texto visível vira "Link copied." por 2s, e quem está no
      // botão com o leitor de tela continua sabendo qual botão é.
      aria-label={copyLabel ?? forLabel("creatorPanel.shareLink.copyAria")}
      aria-describedby={copyDescribedBy}
      // O marco sai no tamanho do fluxo (48px, 15px/600), não no 12px da fileira.
      // Fora dele copiar é ação secundária: contorno, nunca o azul cheio.
      className={accent ? "button-accent button-lg" : `button-outline gap-1.5 ${actionClass}`}
    >
      <CopyIcon aria-hidden="true" size={14} />
      {copied ? t("creatorPanel.shareLink.copied") : (copyLabel ?? t("creatorPanel.shareLink.copy"))}
    </button>
  );
  // Anunciado uma vez, sem linha visível a mais (o botão já mostra).
  const feedback = (
    <>
      {copied ? <p role="status" className="sr-only">{t("creatorPanel.shareLink.copied")}</p> : null}
      {result === "error" ? <p role="alert" className="mt-2 text-sm text-[var(--color-danger-fg)]">{t("creatorPanel.shareLink.copyError")}</p> : null}
    </>
  );

  if (compact) {
    return (
      <div className="mt-2 min-w-0">
        {copyButton}
        {feedback}
        {/* Sem a caixa, o "copie o link acima" precisa de um link para copiar. */}
        {result === "error" ? <p className="mt-1 break-all font-mono text-xs text-[var(--color-ink)]">{url}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-4 min-w-0 rounded-md border fine-rule bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">{label}</p>
      <p className="mt-1 break-all font-mono text-sm text-[var(--color-ink)]">{url}</p>
      {/* `relative` on the row, not on the Share button: the menu then hangs
          from the row's left edge and never runs past the card on a phone. */}
      <div
        ref={rowRef}
        // Tab para fora do menu fecha (o foco começa dentro dele).
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (open && next instanceof Node && !event.currentTarget.contains(next)) {
            setOpen(false);
          }
        }}
        className="relative mt-3 flex flex-wrap gap-2"
      >
        {copyButton}
        <a href={url} aria-label={forLabel("creatorPanel.shareLink.openAria")} className={outlineClass}>
          {t("creatorPanel.shareLink.open")}
        </a>
        <button
          ref={shareRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={forLabel("creatorPanel.shareLink.shareAria")}
          onClick={() => setOpen((current) => !current)}
          className={outlineClass}
        >
          {t("creatorPanel.shareLink.share")}
        </button>
        {open ? (
          <div
            ref={menuRef}
            role="menu"
            aria-label={forLabel("creatorPanel.shareLink.menuAria")}
            onKeyDown={(event) => moveFocusByKey(event, MENU_ITEM)}
            className="motion-drop-in absolute left-0 top-[calc(100%+8px)] z-40 w-48 rounded-lg border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-strong)]"
          >
            {targets.map(({ key, href }) => (
              <a
                key={key}
                href={href}
                role="menuitem"
                target={href.startsWith("mailto:") ? undefined : "_blank"}
                rel="noopener noreferrer"
                // Escolher um destino devolve o foco ao Share, em vez de
                // deixá-lo cair no body.
                onClick={() => {
                  setOpen(false);
                  shareRef.current?.focus();
                }}
                className="flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
              >
                {t(`creatorPanel.shareLink.${key}`)}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      {feedback}
    </div>
  );
}
