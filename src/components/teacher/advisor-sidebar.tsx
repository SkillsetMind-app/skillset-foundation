"use client";

import { Send, Sparkles, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefCallback } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { toPlainProse } from "@/domain/plain-prose";
import { isAdvisorEnabled } from "@/lib/advisor/config";
import { hasAnyPermission } from "@/lib/permissions";
import {
  announceFloatingAction,
  onFloatingActionOpened,
} from "@/lib/ui/floating-action";

type Message = { role: "user" | "assistant"; content: string };

// "idle" until the panel is opened for the first time — a teacher who never
// opens the advisor never pays for the round-trip.
type HistoryStatus = "idle" | "loading" | "ready";

type Notice = { text: string } | {
  key: "notReady" | "tooManyMessages" | "sessionExpired" | "somethingWrong" | "unreachable";
};
const AdvisorHeaderContext = createContext<RefCallback<HTMLDivElement> | null>(null);
const HEADER_QUERY = "(min-width: 768px)";

/** Only the persistent /teach layout provides a destination for this slot. */
export function AdvisorHeaderSlot() {
  const register = useContext(AdvisorHeaderContext);
  return register ? <div ref={register} className="advisor-header-slot" /> : null;
}

function useHeaderViewport() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia?.(HEADER_QUERY);
      query?.addEventListener("change", onChange);
      return () => query?.removeEventListener("change", onChange);
    },
    () => window.matchMedia?.(HEADER_QUERY).matches ?? false,
    () => false,
  );
}

export function AdvisorSidebar({ children }: { children?: ReactNode } = {}) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("idle");
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  const header = useHeaderViewport() ? headerTarget : null;
  const registerHeader = useCallback<RefCallback<HTMLDivElement>>((element) => {
    if (!element) return;
    setHeaderTarget(element);
    return () => setHeaderTarget((current) => current === element ? null : current);
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocus = useRef(false);
  const bindTrigger = useCallback((element: HTMLButtonElement | null) => {
    if (!element) restoreTriggerFocus.current = document.activeElement === triggerRef.current;
    triggerRef.current = element;
    if (element && restoreTriggerFocus.current) {
      element.focus({ preventScroll: true });
      restoreTriggerFocus.current = false;
    }
  }, []);
  // Holds the uid whose thread is in state, not a boolean. A ref, not state:
  // the guard has to stay out of the effect's dependency array — as state it
  // would change the deps the moment the fetch starts, React would tear down
  // the running effect, and the load would never settle.
  const historyUidRef = useRef<string | null>(null);
  const uid = user?.uid ?? null;
  const canUseAdvisor = Boolean(isAdvisorEnabled && user && hasAnyPermission({ roles: user.roles }, ["teacherStudio.access"]));
  const noticeText = notice ? ("key" in notice ? t("advisor." + notice.key) : notice.text) : "";
  const suggestions = [t("advisor.suggestions.video"), t("advisor.suggestions.price"), t("advisor.suggestions.outline")];

  function closeAdvisor() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Restore the stored thread on the first open, and only the first per signed-in
  // teacher: the panel is a toggle a teacher flicks open and shut while working,
  // and re-reading the transcript on every flick would spend a round-trip to
  // overwrite state that is already correct — and would race with whatever they
  // sent in between.
  //
  // Deliberately no abort on close. Closing the panel does not discard the
  // thread, so a load that outlives the close still has somewhere useful to
  // land; cancelling it would leave the composer locked with nothing in flight.
  useEffect(() => {
    if (!open || !uid || historyUidRef.current === uid) {
      return;
    }
    // Keyed by uid rather than a plain "already asked" flag. This panel is
    // mounted by the layout and returns null instead of unmounting, so after a
    // sign-out and a sign-in as somebody else its state is still the previous
    // teacher's thread — a boolean guard would show that thread to the new
    // teacher and then refuse to fetch their own. Same reasoning as
    // LegalAcceptanceGate keying its verdict by uid.
    historyUidRef.current = uid;
    const requestedUid = uid;
    setMessages([]);
    setConversationId(null);
    setHistoryStatus("loading");
    void (async () => {
      try {
        const res = await fetch("/api/teach/advisor");
        const data = (await res.json()) as {
          conversationId?: string | null;
          messages?: Message[];
        };
        // Ignore a load that the signed-in teacher changed out from under: it
        // is the previous account's transcript and would land in this one.
        const stillOurs = historyUidRef.current === requestedUid;
        if (res.ok && Array.isArray(data.messages) && stillOurs) {
          setConversationId(data.conversationId ?? null);
          // Stored rows hold the model's raw output — persistTurn writes the
          // reply before toPlainProse ever sees it — so a restored thread would
          // show the "**bold**" and "## heading" markers that the same reply
          // never showed when it was live. Assistant turns only: a teacher's own
          // asterisks are their words, not markup to clean up.
          setMessages(
            data.messages.map((message) =>
              message.role === "assistant"
                ? { ...message, content: toPlainProse(message.content) }
                : message,
            ),
          );
        }
      } catch {
        // Swallowed on purpose, with no notice shown. A transcript we cannot
        // read is a smaller loss than a panel that opens onto an error, and the
        // teacher's next message simply starts a fresh thread server-side.
      } finally {
        if (historyUidRef.current === requestedUid) {
          setHistoryStatus("ready");
        }
      }
    })();
  }, [open, uid]);

  // `open` belongs in the deps: only the <section> is conditionally rendered, so
  // messages survive a close, but the scroll container is a fresh node on reopen
  // and starts at the top. Without it, a teacher who closes the advisor to edit
  // the course and reopens it to re-read the advice lands on the greeting and
  // has to scroll the whole thread back down.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages, isSending, notice]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(
    () =>
      onFloatingActionOpened((action) => {
        if (action !== "advisor") {
          setOpen(false);
        }
      }),
    [],
  );

  // Hidden until the model keys are set in production
  // (NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED — see src/lib/advisor/config.ts) and
  // only for teachers. The layout renders outside each page's ProtectedSurface,
  // so we repeat the teacherStudio.access check here rather than assume the tree
  // gated it — a signed-in non-teacher landing on /teach shouldn't see it.
  // The gate below hides only the advisor. Its layout children always render.

  async function send(text: string) {
    const trimmed = text.trim();
    // Blocking the send is the fix for the load race, not merely its disguise:
    // the GET assigns `messages` wholesale, so a turn started mid-load would be
    // erased by the history landing on top of it — and its reply would then
    // append to a thread the teacher never saw it answer. The typed text stays
    // in the composer, so the block costs a keypress, not a message.
    if (!trimmed || isSending || historyStatus !== "ready") {
      return;
    }
    const next: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setNotice(null);
    setIsSending(true);
    try {
      const res = await fetch("/api/teach/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, conversationId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
        conversationId?: string | null;
      };
      if (res.ok && typeof data.reply === "string") {
        // Adopt whatever came back, null included. The route returns null when
        // it stored nothing (a new thread it could not open, or an id that
        // failed the ownership check), and holding on to a dead id would make
        // every later turn ask the server to append to a thread that is not
        // ours — silently dropping the transcript for the rest of the session.
        setConversationId(data.conversationId ?? null);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: toPlainProse(data.reply as string) },
        ]);
      } else if (res.status === 503) {
        setNotice(data.reply != null ? { text: data.reply } : { key: "notReady" });
      } else if (res.status === 429) {
        setNotice({ key: "tooManyMessages" });
      } else if (res.status === 401) {
        setNotice({ key: "sessionExpired" });
      } else {
        setNotice(data.error != null ? { text: data.error } : { key: "somethingWrong" });
      }
    } catch {
      setNotice({ key: "unreachable" });
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function toggleAdvisor() {
    const nextOpen = !open;
    if (nextOpen) {
      announceFloatingAction("advisor");
    }
    setOpen(nextOpen);
  }

  // One button moves between the current header and the mobile floating slot;
  // the panel, draft and conversation stay mounted in the /teach layout.
  const trigger = (
    <button
      ref={bindTrigger}
      type="button"
      onClick={toggleAdvisor}
      aria-label={open ? t("advisor.close") : t("advisor.open")}
      aria-expanded={open}
      title={open ? t("advisor.close") : t("advisor.open")}
      className={"advisor-trigger flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-[var(--color-base)] shadow-[0_10px_30px_rgba(15,31,58,0.3)] transition-transform hover:scale-[1.03]" + (header ? " advisor-trigger--header" : "")}
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      <span className="advisor-trigger-label">{open ? t("advisor.closeLabel") : t("advisor.trigger")}</span>
    </button>
  );

  return (
    <AdvisorHeaderContext.Provider value={canUseAdvisor ? registerHeader : null}>
      {children}
      {canUseAdvisor ? <>
      <div className="floating-action floating-action--advisor flex flex-col items-end gap-3">
      {open ? (
        <section
          role="dialog"
          aria-label={t("advisor.title")}
          className="advisor-panel flex w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[16px] border border-[var(--color-line)] bg-white shadow-[0_18px_50px_rgba(15,31,58,0.22)]"
        >
          <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-primary)]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {t("advisor.title")}
            </span>
            <button
              type="button"
              onClick={closeAdvisor}
              aria-label={t("advisor.close")}
              className="grid size-11 shrink-0 place-items-center rounded-full text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-line)] hover:text-[var(--color-ink)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
            aria-live="polite"
          >
            <p className="rounded-[12px] bg-[var(--color-surface-soft)] px-3 py-2.5 text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("advisor.greeting")}
            </p>

            {historyStatus === "loading" ? (
              <p className="text-xs font-medium text-[var(--color-ink-muted)]">
                {t("advisor.loading")}
              </p>
            ) : null}

            {/* Held back until the load settles: rendering them first would show
                a teacher with a saved thread three starter prompts that vanish a
                beat later, and inviting a click on one is exactly the send the
                composer is busy refusing. */}
            {historyStatus === "ready" && messages.length === 0 ? (
              <div className="flex flex-col gap-2 pt-1">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="rounded-[10px] border border-[var(--color-line)] px-3 py-2 text-left text-xs font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-soft)]"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}

            {messages.map((message, index) => (
              <div
                key={index}
                className={
                  message.role === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                <p
                  className={[
                    "max-w-[85%] whitespace-pre-wrap rounded-[12px] px-3 py-2 text-sm leading-6",
                    message.role === "user"
                      ? "bg-[var(--color-primary)] text-[var(--color-base)]"
                      : "border border-[var(--color-line)] bg-white text-[var(--color-ink)]",
                  ].join(" ")}
                >
                  {message.content}
                </p>
              </div>
            ))}

            {isSending ? (
              <p className="text-xs font-medium text-[var(--color-ink-muted)]">
                {t("advisor.thinking")}
              </p>
            ) : null}

            {noticeText ? (
              <p className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2 text-xs leading-5 text-[var(--color-ink-soft)]">
                {noticeText}
              </p>
            ) : null}
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-2 border-t border-[var(--color-line)] p-3"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              placeholder={t("advisor.placeholder")}
              aria-label={t("advisor.messageLabel")}
              rows={1}
              maxLength={4000}
              className="field-input max-h-28 flex-1 resize-none"
            />
            <button
              type="submit"
              disabled={isSending || historyStatus !== "ready" || input.trim().length === 0}
              aria-label={t("advisor.send")}
              className="button-solid flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] p-0 disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </section>
      ) : null}

        {header ? null : trigger}
      </div>
      {header ? createPortal(trigger, header) : null}
      </> : null}
    </AdvisorHeaderContext.Provider>
  );
}
