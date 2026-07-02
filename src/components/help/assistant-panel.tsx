"use client";

import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isAssistantEnabled } from "@/lib/assistant/config";

type Message = { role: "user" | "assistant"; content: string };

const GREETING =
  "Hi — I'm the Skillset assistant. Ask me anything about courses, plans, refunds, payouts, or getting started. I answer from the platform's own documentation.";

const SUGGESTIONS = [
  "How do refunds work?",
  "When do creators get paid?",
  "Which plan should I start on?",
];

// Inline chat card at the top of the help center. Renders nothing until
// NEXT_PUBLIC_PLATFORM_ASSISTANT_ENABLED is true, so /help is unchanged while
// the n8n flow is being wired. Open to signed-out visitors by design —
// pre-sales questions are the main use case; /api/assistant rate-limits by IP.
export function AssistantPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSending, notice]);

  if (!isAssistantEnabled) {
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
      const res = await fetch("/api/assistant", {
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
        setNotice(data.reply ?? "The assistant is being set up and will be available shortly.");
      } else if (res.status === 429) {
        setNotice("You've sent a lot of messages. Please wait a moment and try again.");
      } else {
        setNotice(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setNotice("Couldn't reach the assistant. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void send(input);
  }

  return (
    <section
      aria-label="Skillset assistant"
      className="mb-10 rounded-[18px] border fine-rule bg-[var(--color-surface-soft)] p-5 sm:p-7"
    >
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Ask the assistant
      </p>

      <div
        ref={scrollRef}
        className="mt-4 max-h-80 space-y-3 overflow-y-auto"
        aria-live="polite"
      >
        <p className="rounded-[12px] bg-white px-3 py-2.5 text-sm leading-6 text-[var(--color-ink-soft)]">
          {GREETING}
        </p>

        {messages.length === 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send(suggestion)}
                className="rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2 text-left text-xs font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-strong)]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        {messages.map((message, index) => (
          <div
            key={index}
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
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
            Assistant is thinking…
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2 text-xs leading-5 text-[var(--color-ink-soft)]">
            {notice}
          </p>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
          placeholder="Ask about plans, refunds, payouts…"
          rows={1}
          maxLength={1200}
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
  );
}
