"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { BusyLabel } from "@/components/ui/busy-label";
import { InlineAlert } from "@/components/ui/inline-alert";
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

// Moderating a community post or reply.
//
// POR QUE ISTO EXISTE
//
// The course owner saw spam in their own community and had no button at all, and
// the learner had no way to alert the staff ("Report anything off", say the
// rules, with nowhere to report). Who sees what:
//   - author: Delete;
//   - course owner (canModerate): Delete anything in the course and
//     Fixar/Desafixar posts;
//   - another member: Report (goes to the /ops queue; the teacher does not read it);
//   - not signed in: nothing.
// The database really decides (DELETE and community_reports policies); this
// only shows the button to whoever the database will allow.
//
// Returns a fragment: whoever uses it puts it inside a flex-wrap container, and the
// open panel (confirm or report) takes the whole line (basis-full).
//
// Keyboard: the confirm panel receives focus (on "Keep it", the safe side);
// Esc closes the open panel and returns focus to the button that opened it; after
// deleting, focus goes to the next item in the list (marked with
// data-community-item) or, with no neighbor, to the drawer or the list title
// (data-community-heading). Antes ele caia no body.

const REASONS: CommunityReportReason[] = ["spam", "harassment", "unsafe_content", "off_topic", "other"];

const ACTION =
  "min-h-11 rounded-md px-3 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]";

const FOCUSABLE = "button:not([disabled]), a[href]";

/** Where focus goes when the item leaves the screen. Computed BEFORE deleting. */
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

// The database refuses the same person's second OPEN report on the same target
// (trigger community_reports_trusted_fields): the screen says thanks again.
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
  /** Absent = the action is about the post; present = about this reply. */
  comment?: CommunityComment | null;
  currentUser: SkillsetUser | null;
  canModerate: boolean;
  /** After the database confirmed: it disappears from the screen without waiting for realtime. */
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const [panel, setPanel] = useState<"none" | "delete" | "report">("none");
  const [busy, setBusy] = useState(false);
  // Dictionary key, not text: the language can change with the error on screen.
  const [error, setError] = useState("");
  const [reason, setReason] = useState<CommunityReportReason>("spam");
  const [detail, setDetail] = useState("");
  // "done" = just reported; "duplicate" = had already reported before.
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
    // Closes only the panel: the drawer around it also closes with Esc.
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
          // aria-disabled, not disabled: a disabled button loses keyboard focus.
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
        <p role="status" className="basis-full text-xs font-semibold text-[var(--color-success-fg)]">
          {t(reported === "duplicate" ? "learn.community.report.duplicate" : "learn.community.report.done")}
        </p>
      ) : null}

      {panel === "delete" ? (
        // Confirmation, not error: it stays a group (an alert would be read out alone when
        // it opens). The background is the token, which goes up to 18% in the dark theme; the
        // literal 6% vanished on near-black.
        <div
          id={panelId}
          role="group"
          aria-labelledby={`${panelId}-title`}
          onKeyDown={closeOnEscape}
          className="flex basis-full flex-wrap items-center gap-2 rounded-md border border-[rgba(178,34,52,0.2)] bg-[var(--color-danger-soft)] p-3"
        >
          <p id={`${panelId}-title`} className="w-full text-sm font-semibold text-[var(--color-ink)]">
            {t(confirmKey)}
          </p>
          <button
            type="button"
            onClick={() => void confirmDelete()}
            disabled={busy}
            className="button-danger min-h-11 px-3 text-sm"
          >
            <BusyLabel
              busy={busy}
              idle={t("learn.community.actions.deleteYes")}
              busyText={t("learn.community.actions.deleting")}
            />
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
            <button type="submit" disabled={busy} className="button-solid min-h-11 px-3 text-sm">
              <BusyLabel
                busy={busy}
                idle={t("learn.community.report.send")}
                busyText={t("learn.community.report.sending")}
              />
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <InlineAlert tone="error" className="basis-full px-3 py-2 text-xs leading-5">
          {t(error)}
        </InlineAlert>
      ) : null}
    </>
  );
}
