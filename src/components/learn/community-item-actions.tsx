"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { SkillsetUser } from "@/domain/auth";
import type { CommunityComment, CommunityPost } from "@/domain/community-post";
import type { CommunityReportReason } from "@/domain/community-report";
import {
  createCommunityReport,
  deleteCommunityComment,
  deleteCommunityPost,
  setCommunityPostPinned,
} from "@/lib/data/community-posts";
import { isRateLimitError } from "@/lib/data/rate-limit-error";

// Moderar um post ou uma resposta da comunidade.
//
// POR QUE ISTO EXISTE
//
// O dono do curso via spam na propria comunidade e nao tinha botao nenhum, e
// o aluno nao tinha como avisar a equipe ("Report anything off", dizem as
// regras, sem onde reportar). Quem ve o que:
//   - autor: Apagar;
//   - dono do curso (canModerate): Apagar qualquer coisa do curso e
//     Fixar/Desafixar posts;
//   - outro membro: Denunciar (vai para a fila do /ops; o professor nao le);
//   - sem login: nada.
// O banco decide de verdade (policies de DELETE e de community_reports); isto
// so mostra o botao para quem o banco vai deixar.
//
// Devolve um fragmento: quem usa poe dentro de um container flex-wrap, e o
// painel aberto (confirmar ou denunciar) ocupa a linha inteira (basis-full).
//
// Teclado: o painel de confirmar recebe o foco (em "Keep it", o lado seguro);
// Esc fecha o painel aberto e devolve o foco ao botao que o abriu; depois de
// apagar, o foco vai para o item seguinte da lista (marcado com
// data-community-item) ou, sem vizinho, para a gaveta ou o titulo da lista
// (data-community-heading). Antes ele caia no body.

const REASONS: CommunityReportReason[] = ["spam", "harassment", "unsafe_content", "off_topic", "other"];

const ACTION =
  "min-h-11 rounded-md px-3 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]";

const FOCUSABLE = "button:not([disabled]), a[href]";

/** Para onde o foco vai quando o item sai da tela. Calculado ANTES de apagar. */
function focusTargetAfterDelete(from: HTMLElement | null): HTMLElement | null {
  const item = from?.closest("[data-community-item]");
  const neighbour = [item?.nextElementSibling, item?.previousElementSibling].find((element) =>
    element?.matches("[data-community-item]"),
  );
  return (
    neighbour?.querySelector<HTMLElement>(FOCUSABLE) ??
    from?.closest("[role='dialog']")?.querySelector<HTMLElement>(FOCUSABLE) ??
    document.querySelector<HTMLElement>("[data-community-heading]")
  );
}

// O banco recusa a segunda denuncia ABERTA da mesma pessoa no mesmo alvo
// (trigger community_reports_trusted_fields): a tela agradece de novo.
function isDuplicateReport(failure: unknown): boolean {
  const message = failure && typeof failure === "object" && "message" in failure ? failure.message : null;
  return typeof message === "string" && message.startsWith("COMMUNITY_REPORT_DUPLICATE");
}

export function CommunityItemActions({
  post,
  comment = null,
  currentUser,
  canModerate,
  onDeleted,
}: {
  post: CommunityPost;
  /** Ausente = a acao e sobre o post; presente = sobre esta resposta. */
  comment?: CommunityComment | null;
  currentUser: SkillsetUser | null;
  canModerate: boolean;
  /** Depois que o banco confirmou: some da tela sem esperar o realtime. */
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const [panel, setPanel] = useState<"none" | "delete" | "report">("none");
  const [busy, setBusy] = useState(false);
  // Chave do dicionario, nao texto: o idioma pode trocar com o erro na tela.
  const [error, setError] = useState("");
  const [reason, setReason] = useState<CommunityReportReason>("spam");
  const [detail, setDetail] = useState("");
  // "done" = acabou de denunciar; "duplicate" = ja tinha denunciado antes.
  const [reported, setReported] = useState<"" | "done" | "duplicate">("");
  const deleteRef = useRef<HTMLButtonElement>(null);
  const reportRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (panel === "delete") {
      keepRef.current?.focus();
    }
  }, [panel]);

  const item = comment ?? post;
  const isAuthor = Boolean(currentUser) && currentUser?.uid === item.authorId;
  const canDelete = Boolean(currentUser) && (isAuthor || canModerate);
  const canReport = Boolean(currentUser) && !isAuthor && !canModerate;
  const canPin = canModerate && !comment;

  if (!canDelete && !canReport && !canPin) {
    return null;
  }

  function toggle(next: "delete" | "report") {
    setError("");
    setPanel((current) => (current === next ? "none" : next));
  }

  function closePanel() {
    const opener = panel === "delete" ? deleteRef.current : reportRef.current;
    setPanel("none");
    opener?.focus();
  }

  function closeOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    // Fecha so o painel: a gaveta em volta tambem fecha com Esc.
    event.preventDefault();
    event.stopPropagation();
    closePanel();
  }

  async function togglePin() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await setCommunityPostPinned(post.id, !post.pinned);
    } catch {
      setError("learn.community.actions.pinError");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setError("");
    setBusy(true);
    const nextFocus = focusTargetAfterDelete(deleteRef.current);
    try {
      if (comment) {
        await deleteCommunityComment(comment.id);
      } else {
        await deleteCommunityPost(post.id);
      }
      setPanel("none");
      nextFocus?.focus();
      onDeleted?.();
    } catch {
      setError("learn.community.actions.deleteError");
    } finally {
      setBusy(false);
    }
  }

  async function sendReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) return;
    setError("");
    setBusy(true);
    try {
      await createCommunityReport({
        courseSlug: post.courseSlug,
        postId: post.id,
        commentId: comment?.id ?? null,
        targetType: comment ? "comment" : "post",
        targetAuthorId: item.authorId,
        targetAuthorName: item.authorName,
        reason,
        detail: detail.trim() || null,
        user: currentUser,
      });
      setPanel("none");
      setReported("done");
    } catch (failure) {
      if (isDuplicateReport(failure)) {
        setPanel("none");
        setReported("duplicate");
      } else {
        setError(isRateLimitError(failure) ? "learn.community.report.rateLimit" : "learn.community.report.error");
      }
    } finally {
      setBusy(false);
    }
  }

  const confirmKey = comment ? "learn.community.actions.deleteConfirmReply" : "learn.community.actions.deleteConfirmPost";

  return (
    <>
      {canPin ? (
        <button
          type="button"
          onClick={() => void togglePin()}
          // aria-disabled, nao disabled: botao desabilitado perde o foco do teclado.
          aria-disabled={busy}
          className={ACTION}
        >
          {t(post.pinned ? "learn.community.card.unpin" : "learn.community.card.pin")}
        </button>
      ) : null}
      {canDelete ? (
        <button
          ref={deleteRef}
          type="button"
          onClick={() => toggle("delete")}
          aria-expanded={panel === "delete"}
          aria-controls={panel === "delete" ? panelId : undefined}
          className={ACTION}
        >
          {t("learn.community.actions.delete")}
        </button>
      ) : null}
      {canReport && !reported ? (
        <button
          ref={reportRef}
          type="button"
          onClick={() => toggle("report")}
          aria-expanded={panel === "report"}
          aria-controls={panel === "report" ? panelId : undefined}
          className={ACTION}
        >
          {t("learn.community.actions.report")}
        </button>
      ) : null}
      {reported ? (
        <p role="status" className="basis-full text-xs font-semibold text-[rgb(21,128,61)]">
          {t(reported === "duplicate" ? "learn.community.report.duplicate" : "learn.community.report.done")}
        </p>
      ) : null}

      {panel === "delete" ? (
        <div
          id={panelId}
          role="group"
          aria-labelledby={`${panelId}-title`}
          onKeyDown={closeOnEscape}
          className="flex basis-full flex-wrap items-center gap-2 rounded-md border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] p-3"
        >
          <p id={`${panelId}-title`} className="w-full text-sm font-semibold text-[var(--color-ink)]">
            {t(confirmKey)}
          </p>
          <button
            type="button"
            onClick={() => void confirmDelete()}
            disabled={busy}
            className="button-danger min-h-11 px-3 text-sm disabled:opacity-60"
          >
            {t(busy ? "learn.community.actions.deleting" : "learn.community.actions.deleteYes")}
          </button>
          <button
            ref={keepRef}
            type="button"
            onClick={closePanel}
            className="button-outline min-h-11 px-3 text-sm"
          >
            {t("learn.community.actions.keep")}
          </button>
        </div>
      ) : null}

      {panel === "report" ? (
        <form
          id={panelId}
          onSubmit={sendReport}
          onKeyDown={closeOnEscape}
          aria-labelledby={`${panelId}-title`}
          className="grid basis-full gap-2 rounded-md border border-[var(--color-line)] bg-white p-3"
        >
          <p id={`${panelId}-title`} className="text-sm font-semibold text-[var(--color-ink)]">
            {t(comment ? "learn.community.report.titleReply" : "learn.community.report.titlePost")}
          </p>
          <p className="text-xs leading-5 text-[var(--color-ink-soft)]">{t("learn.community.report.intro")}</p>
          <label className="grid gap-1 text-sm font-semibold text-[var(--color-ink)]">
            {t("learn.community.report.reason")}
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value as CommunityReportReason)}
              className="field-input min-h-11 font-normal"
            >
              {REASONS.map((value) => (
                <option key={value} value={value}>
                  {t(`learn.community.report.reasons.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-[var(--color-ink)]">
            {t("learn.community.report.detail")}
            <textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={500}
              rows={2}
              className="field-input min-h-[64px] resize-y font-normal"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={closePanel}
              className="button-outline min-h-11 px-3 text-sm"
            >
              {t("learn.community.report.cancel")}
            </button>
            <button type="submit" disabled={busy} className="button-solid min-h-11 px-3 text-sm disabled:opacity-60">
              {t(busy ? "learn.community.report.sending" : "learn.community.report.send")}
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="basis-full text-xs font-semibold text-[var(--color-danger-fg)]">
          {t(error)}
        </p>
      ) : null}
    </>
  );
}
