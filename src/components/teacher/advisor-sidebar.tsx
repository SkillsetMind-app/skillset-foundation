"use client";

import { Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { isAdvisorEnabled } from "@/lib/advisor/config";
import { hasAnyPermission } from "@/lib/permissions";
import {
  announceFloatingAction,
  onFloatingActionOpened,
} from "@/lib/ui/floating-action";

type Message = { role: "user" | "assistant"; content: string };

const GREETING =
  "Hi — I'm your studio advisor. Ask me about structuring a course, whether to embed from YouTube or upload your video, pricing, or how to get your first sales.";

const SUGGESTIONS = [
  "Should I embed from YouTube or upload my videos?",
  "How should I price my first course?",
  "Help me outline a course from scratch.",
];

export function AdvisorSidebar() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closeAdvisor() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSending, notice]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
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

  // Hidden until the backend is wired (NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED) and
  // only for teachers. The layout renders outside each page's ProtectedSurface,
  // so we repeat the teacherStudio.access check here rather than assume the tree
  // gated it — a signed-in non-teacher landing on /teach shouldn't see it.
  if (!isAdvisorEnabled || !user || !hasAnyPermission({ roles: user.roles }, ["teacherStudio.access"])) {
    return null;
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) {
      return;
    }
    const next: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setNotice("");
    setIsSending(true);
    try {
      const res = await fetch("/api/teach/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
      };
      if (res.ok && typeof data.reply === "string") {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply as string }]);
      } else if (res.status === 503) {
        setNotice(data.reply ?? "The advisor is being set up and will be available shortly.");
      } else if (res.status === 429) {
        setNotice("You've sent a lot of messages. Please wait a moment and try again.");
      } else if (res.status === 401) {
        setNotice("Your session expired. Refresh the page and sign in again.");
      } else {
        setNotice(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setNotice("Couldn't reach the advisor. Check your connection and try again.");
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

  return (
    <div className="floating-action floating-action--advisor flex flex-col items-end gap-3">
      {open ? (
        <section
          role="dialog"
          aria-label="Studio advisor"
          className="flex h-[min(560px,calc(100dvh-7rem))] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[16px] border border-[var(--color-line)] bg-white shadow-[0_18px_50px_rgba(15,31,58,0.22)]"
        >
          <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-primary)]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Studio advisor
            </span>
            <button
              type="button"
              onClick={closeAdvisor}
              aria-label="Close advisor"
              className="rounded-full p-1 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-line)] hover:text-[var(--color-ink)]"
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
              {GREETING}
            </p>

            {messages.length === 0 ? (
              <div className="flex flex-col gap-2 pt-1">
                {SUGGESTIONS.map((suggestion) => (
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
                Advisor is thinking…
              </p>
            ) : null}

            {notice ? (
              <p className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2 text-xs leading-5 text-[var(--color-ink-soft)]">
                {notice}
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
              placeholder="Ask about videos, pricing, structure…"
              aria-label="Message to studio advisor"
              rows={1}
              maxLength={4000}
              className="field-input max-h-28 flex-1 resize-none"
            />
            <button
              type="submit"
              disabled={isSending || input.trim().length === 0}
              aria-label="Send message"
              className="button-solid flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] p-0 disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </section>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        onClick={toggleAdvisor}
        aria-label={open ? "Close advisor" : "Open studio advisor"}
        aria-expanded={open}
        className="advisor-trigger flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-[var(--color-base)] shadow-[0_10px_30px_rgba(15,31,58,0.3)] transition-transform hover:scale-[1.03]"
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        <span className="advisor-trigger-label">{open ? "Close" : "Advisor"}</span>
      </button>
    </div>
  );
}
