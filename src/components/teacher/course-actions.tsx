"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import { moveFocusByKey } from "@/lib/a11y/menu-keys";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import {
  deleteOrArchiveCourse,
  getCourseAudience,
  type DeleteOrArchiveOutcome,
} from "@/lib/data/teacher-courses";

// As duas pecas que a lista de produtos e o hub do curso dividem. Antes cada
// tela tinha (ou nao tinha) a sua: o menu ⋮ so existia na lista, o hub nao
// tinha acao nenhuma, e apagar era privilegio de rascunho. Uma acao so, no
// mesmo lugar da Hotmart, precisa de um componente so.

// Largura do menu (w-56). Fixa de proposito: medir o DOM depois de abrir
// custaria um segundo render so para descobrir um numero que nao muda.
const MENU_WIDTH_PX = 224;
// Folga minima entre o menu e a borda da janela.
const MENU_MARGIN_PX = 8;
const MENU_ITEM = '[role="menuitem"]';

/**
 * Casca do menu de acoes: gatilho so-icone, fecha no Escape e no clique fora,
 * devolve o foco ao gatilho. Os ITENS vem de quem chama — a lista oferece
 * editar/ver como aluno/excluir, o hub oferece novo produto/ver como
 * aluno/excluir.
 */
export function CourseActionsMenu({
  courseTitle,
  icon: Icon,
  children,
}: {
  courseTitle: string;
  icon: ComponentType<{ "aria-hidden"?: boolean | "true"; size?: number; strokeWidth?: number }>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // No celular e no tablet a lista vira cartao e o gatilho fica encostado na
  // borda ESQUERDA; um menu ancorado a direita dele nascia com o lado esquerdo
  // fora da tela (QA visual em producao, 08/09). Ao abrir, o menu e posto onde
  // cabe: alinhado a direita do gatilho quando da (desktop), senao empurrado
  // para dentro da janela — pelos DOIS lados, porque a 390 px com titulo longo
  // ou em espanhol o gatilho pode cair no meio da linha (revisao do Codex).
  const [menuLeftPx, setMenuLeftPx] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    // Menu aberto = foco no 1º item; antes ficava no gatilho e as setas não
    // tinham onde agir.
    menuRef.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();

    function handlePointerDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("creatorPanel.products.actions.more").replace("{title}", () => courseTitle)}
        onClick={() => {
          const box = wrapperRef.current?.getBoundingClientRect();
          if (box) {
            const wanted = box.right - MENU_WIDTH_PX;
            const maxLeft = Math.max(
              MENU_MARGIN_PX,
              window.innerWidth - MENU_WIDTH_PX - MENU_MARGIN_PX,
            );
            setMenuLeftPx(Math.min(Math.max(wanted, MENU_MARGIN_PX), maxLeft) - box.left);
          }
          setOpen((current) => !current);
        }}
        className="grid min-h-11 min-w-11 place-items-center rounded-md border border-[var(--color-line-strong)] bg-white text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        <Icon aria-hidden="true" size={19} strokeWidth={2} />
      </button>

      {open ? (
        // Um clique em QUALQUER item fecha o menu e devolve o foco ao gatilho;
        // quem abre um modal logo em seguida rouba o foco no efeito, depois do
        // commit, entao a ordem continua sendo menu -> modal.
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("creatorPanel.products.actions.menu").replace("{title}", () => courseTitle)}
          onKeyDown={(event) => moveFocusByKey(event, MENU_ITEM)}
          onClick={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
          style={menuLeftPx === null ? undefined : { left: menuLeftPx }}
          className={`absolute top-[calc(100%+8px)] z-40 w-56 rounded-lg border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-strong)] ${menuLeftPx === null ? "right-0" : ""}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Confirmacao de excluir/arquivar. Pergunta ao servidor quantos compradores o
 * curso tem ANTES de mostrar o texto, porque as duas respostas sao diferentes
 * demais para caber numa frase so: sem comprador o curso some; com comprador
 * ele sai da loja e quem pagou continua com acesso. Quem decide o destino de
 * verdade e a RPC — este componente so precisa nao mentir sobre ele.
 */
export function DeleteOrArchiveCourseDialog({
  courseId,
  courseTitle,
  onCancel,
  onDone,
}: {
  courseId: string;
  courseTitle: string;
  onCancel: () => void;
  onDone: (outcome: DeleteOrArchiveOutcome) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [audience, setAudience] = useState<{ enrollments: number; orders: number; subscriptions: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useModalFocus(dialogRef, true);

  useEffect(() => {
    let live = true;
    getCourseAudience(courseId)
      .then((next) => {
        if (live) setAudience(next);
      })
      .catch(() => {
        // Sem a contagem nao da para escolher o texto honesto, e o modal nao
        // pode chutar o mais tranquilizador: fecha e deixa o erro na tela de
        // quem chamou, em vez de prometer arquivamento e apagar o curso.
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [courseId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  // Assinatura tambem e comprador: o servidor arquiva, entao o texto promete arquivar.
  const hasAudience = audience !== null && audience.enrollments + audience.orders + audience.subscriptions > 0;
  const prefix = hasAudience ? "creatorPanel.products.archive" : "creatorPanel.products.delete";
  // Sem a contagem, nem "apagar" nem "arquivar": o modal abria em vermelho
  // dizendo Delete e virava Archive em azul quando a resposta chegava.
  const known = audience !== null;

  async function handleConfirm() {
    setBusy(true);
    try {
      onDone(await deleteOrArchiveCourse(courseId));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-[70] grid place-items-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("creatorPanel.products.delete.aria").replace("{title}", () => courseTitle)}
        className="modal-panel modal-panel-scroll w-full max-w-md rounded-xl border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-strong)] outline-none"
      >
        <p className={`text-xs font-bold uppercase tracking-[0.2em] ${known ? "text-[var(--color-danger-fg)]" : "text-[var(--color-ink-muted)]"}`}>
          {known ? t(`${prefix}.eyebrow`) : t("creatorPanel.products.removeEyebrow")}
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--color-primary)]">
          {known ? t(`${prefix}.title`).replace("{title}", () => courseTitle) : courseTitle}
        </h2>
        {/* Altura do texto mais longo (o de apagar, com a lista e o aviso dos
            arquivos): os botoes nao pulam quando a contagem chega. */}
        <div className="min-h-[27rem] sm:min-h-[21rem]">
        {known ? (
          <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${prefix}.description`)}
          </p>
        ) : failed ? null : (
          <div aria-hidden="true" className="mt-4 grid gap-2 motion-safe:animate-pulse">
            <span className="h-3 w-full rounded bg-[var(--color-surface-strong)]" />
            <span className="h-3 w-11/12 rounded bg-[var(--color-surface-strong)]" />
            <span className="h-3 w-2/3 rounded bg-[var(--color-surface-strong)]" />
          </div>
        )}

        {hasAudience ? (
          // O "Importante" da Hotmart: a frase que o professor precisa ler
          // antes de decidir nao pode dividir peso com o resto do texto.
          <InlineAlert tone="warning" className="mt-4 flex items-start gap-2">
            <AlertTriangle aria-hidden="true" size={18} strokeWidth={1.9} className="mt-0.5 shrink-0" />
            <span>{t("creatorPanel.products.archive.callout")}</span>
          </InlineAlert>
        ) : audience !== null ? (
          // O que some junto, dito antes do clique: a migration 20261008030000
          // apaga tudo isto, e a limpeza tira arquivos e videos a partir de um
          // dia depois, de hora em hora, em lotes.
          <>
            <p className="mt-3 text-sm font-semibold text-[var(--color-ink)]">
              {t("creatorPanel.products.delete.consequences.lead")}
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm leading-6 text-[var(--color-ink-soft)]">
              {(["content", "videos", "community", "events"] as const).map((item) => (
                <li key={item}>{t(`creatorPanel.products.delete.consequences.${item}`)}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("creatorPanel.products.delete.filesNote")}
            </p>
          </>
        ) : null}

        {failed ? (
          <InlineAlert tone="error" className="mt-4">
            {t("creatorPanel.products.deleteError")}
          </InlineAlert>
        ) : null}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="button-outline px-4 text-sm disabled:opacity-60"
          >
            {t("creatorPanel.products.delete.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy || !known}
            // Apagar e para sempre: vermelho cheio. Arquivar volta atras: azul.
            // Antes da contagem, contorno neutro: nem um nem outro.
            className={`${!known ? "button-outline" : hasAudience ? "button-solid" : "button-danger button-danger-solid"} px-4 text-sm disabled:opacity-60`}
          >
            {!known && !failed ? t("creatorPanel.products.removeChecking") : busy ? t(`${prefix}.busy`) : t(`${prefix}.confirm`)}
          </button>
        </div>
      </div>
    </div>
  );
}
