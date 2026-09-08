"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
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
  // fora da tela (QA visual em producao, 08/09). Sem espaco a esquerda, o menu
  // ancora a esquerda; no desktop (gatilho na borda direita) segue right-0.
  const [alignLeft, setAlignLeft] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

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
          const rect = triggerRef.current?.getBoundingClientRect();
          setAlignLeft(rect !== undefined && rect.right - MENU_WIDTH_PX < 0);
          setOpen((current) => !current);
        }}
        className="grid min-h-11 min-w-11 place-items-center rounded-[7px] border border-[var(--color-line-strong)] bg-white text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        <Icon aria-hidden="true" size={19} strokeWidth={2} />
      </button>

      {open ? (
        // Um clique em QUALQUER item fecha o menu e devolve o foco ao gatilho;
        // quem abre um modal logo em seguida rouba o foco no efeito, depois do
        // commit, entao a ordem continua sendo menu -> modal.
        <div
          role="menu"
          aria-label={t("creatorPanel.products.actions.menu").replace("{title}", () => courseTitle)}
          onClick={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
          className={`absolute top-[calc(100%+8px)] z-40 w-56 rounded-[8px] border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-strong)] ${alignLeft ? "left-0" : "right-0"}`}
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
  const [audience, setAudience] = useState<{ enrollments: number; orders: number } | null>(null);
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

  const hasAudience = audience !== null && audience.enrollments + audience.orders > 0;
  const prefix = hasAudience ? "creatorPanel.products.archive" : "creatorPanel.products.delete";

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
      className="fixed inset-0 z-[70] grid place-items-center bg-[rgba(7,9,13,0.55)] p-4"
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
        className="modal-panel modal-panel-scroll w-full max-w-md rounded-[16px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-strong)] outline-none"
      >
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-danger-fg)]">
          {t(`${prefix}.eyebrow`)}
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--color-primary)]">
          {t(`${prefix}.title`).replace("{title}", () => courseTitle)}
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t(`${prefix}.description`)}
        </p>

        {hasAudience ? (
          // O "Importante" da Hotmart: a frase que o professor precisa ler
          // antes de decidir nao pode dividir peso com o resto do texto.
          <InlineAlert tone="warning" className="mt-4 flex items-start gap-2">
            <AlertTriangle aria-hidden="true" size={18} strokeWidth={1.9} className="mt-0.5 shrink-0" />
            <span>{t("creatorPanel.products.archive.callout")}</span>
          </InlineAlert>
        ) : null}

        {failed ? (
          <InlineAlert tone="error" className="mt-4">
            {t("creatorPanel.products.deleteError")}
          </InlineAlert>
        ) : null}

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
            disabled={busy || audience === null}
            className={`${hasAudience ? "button-solid" : "button-danger"} px-4 text-sm disabled:opacity-60`}
          >
            {busy ? t(`${prefix}.busy`) : t(`${prefix}.confirm`)}
          </button>
        </div>
      </div>
    </div>
  );
}
