"use client";

import { Bell, BellOff, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { NotificationRow } from "@/components/account/notification-row";
import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import { notificationHref, type AppNotification } from "@/domain/notification";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToNotifications,
} from "@/lib/data/notifications";

export function NotificationBell() {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const uid = status === "authenticated" ? user?.uid ?? null : null;

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  // Para qual uid a lista chegou, e para qual a primeira leitura falhou. Antes
  // o sino dizia "You're all caught up" enquanto a lista nao chegava e, se a
  // leitura falhava, para sempre. Agora: formato de aviso ate a resposta, erro
  // com "Try again" na falha, e "caught up" so quando o banco respondeu vazio.
  // Guardar o uid (e nao zerar dentro do efeito) evita o setState em cascata.
  const [loadedUid, setLoadedUid] = useState<string | null>(null);
  const [failedUid, setFailedUid] = useState<string | null>(null);
  // "Mark all read" que falhou: antes calava (o catch so engolia) e a pessoa
  // achava que tinha marcado. Os avisos seguem como nao lidos; o painel diz.
  const [markAllFailed, setMarkAllFailed] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!uid) {
      // No synchronous reset here (it would be a setState-in-effect cascade);
      // the component already renders null while signed out, and a fresh uid
      // re-subscribes below.
      return;
    }

    const current = subscribeToNotifications(
      uid,
      (incoming) => {
        setNotifications(incoming);
        setLoadedUid(uid);
        setFailedUid(null);
      },
      // Uma releitura que falha com a lista ja na tela mantem a lista: antes
      // ela esvaziava e o painel passava a dizer "You're all caught up".
      () => setFailedUid(uid),
    );
    subscription.current = current;
    return () => {
      subscription.current = null;
      current();
    };
  }, [uid]);

  // Ao abrir, o foco entra no painel (no titulo): quem usa teclado ou leitor
  // de tela cai dentro dele, e nao fica parado no sino.
  useEffect(() => {
    if (open) {
      titleRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleMouseDown(event: MouseEvent) {
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

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const loaded = uid !== null && loadedUid === uid;
  const loadFailed = !loaded && uid !== null && failedUid === uid;
  // So a lista que chegou para ESTE uid conta; ate la, nada de outra conta.
  const items = useMemo(() => (loaded ? notifications : []), [loaded, notifications]);
  const unreadCount = useMemo(
    () => items.filter((item) => !item.read).length,
    [items],
  );

  // The bell lives in the authenticated shell, but guard so a signed-out or
  // still-loading render is inert rather than throwing on a null uid.
  if (!uid) {
    return null;
  }

  async function handleActivate(notification: AppNotification) {
    if (!uid || notification.read) {
      return;
    }
    try {
      await markNotificationAsRead(uid, notification.id);
    } catch {
      // Read-state is non-critical; the realtime subscription stays correct.
    }
  }

  async function handleMarkAll() {
    if (!uid) {
      return;
    }
    const unreadIds = notifications
      .filter((item) => !item.read)
      .map((item) => item.id);
    if (unreadIds.length === 0) {
      return;
    }
    setMarkAllFailed(false);
    try {
      await markAllNotificationsAsRead(uid, unreadIds);
    } catch {
      setMarkAllFailed(true);
    }
  }

  // "Try again" le de novo pelo mesmo canal (ver subscribeToNotifications).
  // O botao some (volta o esqueleto): o foco vai para o titulo do painel, em
  // vez de cair na pagina.
  function retryLoad() {
    titleRef.current?.focus();
    setFailedUid(null);
    void subscription.current?.reload();
  }

  // Fechar pelo X ou pelo Esc devolve o foco ao sino, de onde a pessoa veio.
  function closeToTrigger() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Filter client-side off the already-subscribed list (no re-query), then keep
  // the existing 6-item preview slice.
  const filtered =
    filter === "unread"
      ? items.filter((item) => !item.read)
      : items;
  const preview = filtered.slice(0, 6);

  return (
    // Abaixo de 768px o painel se prende a barra do topo (como a busca), nao ao
    // sino: a conta e o idioma ficam a direita do sino, e alinhado a ele o
    // painel de 343px comecava fora da tela (x = -88 em 375px).
    <div
      ref={wrapperRef}
      className="relative max-md:static"
      onBlur={(event) => {
        // Tab para fora do painel fecha, como a Ajuda ao lado. Foco para
        // "lugar nenhum" (clique num texto do painel) nao fecha.
        const next = event.relatedTarget;
        if (open && next instanceof Node && !event.currentTarget.contains(next)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          // Abrir de novo começa limpo: a falha de antes não volta nem é lida
          // outra vez. (Fechado, o painel não existe; só se reabre por aqui.)
          if (!open) setMarkAllFailed(false);
          setOpen((current) => !current);
        }}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={
          unreadCount > 0
            ? t("platform.notifications.openUnread").replace(
                "{count}",
                String(unreadCount),
              )
            : t("platform.notifications.open")
        }
        className="relative grid size-11 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-ink)] transition hover:bg-[var(--color-surface-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        <Bell aria-hidden="true" size={18} strokeWidth={1.8} />
        {unreadCount > 0 ? (
          // Branco no latão dava 2.56:1; o navy de --color-on-accent dá 6.67:1.
          <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-bold leading-[18px] text-[var(--color-on-accent)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        // Popover, nao janela centrada: fica preso ao sino (como a Ajuda) e
        // nunca passa da altura da tela; a lista rola por dentro. No celular,
        // 16px da borda direita da barra e no maximo a tela menos 32px: de
        // 320 a 767px sobra pelo menos 16px dos dois lados.
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          aria-busy={!loaded && !loadFailed}
          className="motion-drop-in absolute right-0 top-[calc(100%+8px)] z-50 flex max-h-[calc(100svh-96px)] w-[min(380px,calc(100vw-32px))] flex-col max-md:right-4 overflow-hidden rounded-lg border border-[var(--color-line)] bg-white shadow-[0_24px_48px_rgba(15,39,68,0.16)]"
        >
          {/* Alvos de 44px (sino, X, "Mark all read", filtros, "View all"): antes
              eram 32px e uns 24px de altura, dificeis de acertar no celular. */}
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-line)] py-1.5 pl-5 pr-2">
            <h4
              id={titleId}
              ref={titleRef}
              tabIndex={-1}
              className="rounded-sm text-[15px] font-bold text-[var(--color-primary)]"
            >
              {t("platform.notifications.title")}
            </h4>
            <div className="flex items-center gap-1">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  className="min-h-11 rounded-md px-3 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-soft)]"
                >
                  {t("platform.notifications.markAllRead")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeToTrigger}
                className="grid size-11 place-items-center rounded-md text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)]"
                aria-label={t("platform.notifications.close")}
              >
                <X aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>
          {/* Na falha nao ha o que filtrar: o erro e o "Try again" ficam sozinhos.
              All/Unread filtram a lista, nao trocam de painel: grupo com
              aria-pressed (o padrao dos filtros). Fica o desenho daqui porque
              o seletor segmentado da casa tem 36px e o painel garante 44px. O
              hover so escurece o texto: antes pintava o mesmo fundo da
              escolhida, e nao se sabia qual estava ligada. */}
          <div
            role="group"
            hidden={loadFailed}
            aria-label={t("platform.notifications.filterLabel")}
            className="flex shrink-0 items-center gap-1 border-b border-[var(--color-line)] px-4 py-1"
          >
            {(["all", "unread"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`min-h-11 rounded-md px-3 text-xs font-semibold transition ${
                  filter === value
                    ? "bg-[var(--color-surface-soft)] text-[var(--color-primary)]"
                    : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                }`}
              >
                {value === "all"
                  ? t("platform.notifications.all")
                  : `${t("platform.notifications.unread")}${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
              </button>
            ))}
          </div>
          {/* Só enquanto sobra aviso não lido: lido por outra aba, a falha
              não vale mais. */}
          {markAllFailed && unreadCount > 0 ? (
            <InlineAlert tone="error" className="mx-4 mt-3 shrink-0">
              {t("platform.notifications.markAllError")}
            </InlineAlert>
          ) : null}
          {loadFailed ? (
            <div className="grid gap-3 p-5">
              <InlineAlert tone="error">{t("platform.notifications.loadError")}</InlineAlert>
              <button type="button" onClick={retryLoad} className="button-outline min-h-11 justify-self-start px-4 text-sm">
                {t("appErrors.retry")}
              </button>
            </div>
          ) : !loaded ? (
            // O formato de um aviso (icone e tres linhas) ate a lista chegar.
            <div className="min-h-0 overflow-y-auto">
              <p className="sr-only" role="status">
                {t("platform.notifications.loading")}
              </p>
              <ul aria-hidden="true" className="divide-y divide-[var(--color-line)]">
                {["w-4/5", "w-2/3", "w-3/4"].map((width) => (
                  <li key={width} className="flex items-start gap-3 px-3 py-3">
                    <span className="mt-0.5 size-9 shrink-0 animate-pulse rounded-full bg-[var(--color-surface-strong)]" />
                    <span className="grid flex-1 gap-2 pt-1">
                      <span className={`h-3 animate-pulse rounded-sm bg-[var(--color-surface-strong)] ${width}`} />
                      <span className="h-2.5 w-1/2 animate-pulse rounded-sm bg-[var(--color-surface-strong)]" />
                      <span className="h-2 w-1/5 animate-pulse rounded-sm bg-[var(--color-surface-strong)]" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : preview.length === 0 ? (
            <div className="min-h-0 overflow-y-auto px-5 py-10 text-center">
              <BellOff
                aria-hidden="true"
                size={32}
                strokeWidth={1.6}
                className="mx-auto text-[var(--color-ink-muted)]"
              />
              <p className="mt-3 text-sm font-semibold text-[var(--color-ink)]">
                {t("platform.notifications.caughtUp")}
              </p>
              <p className="mx-auto mt-2 max-w-[220px] text-xs leading-5 text-[var(--color-ink-soft)]">
                {t("platform.notifications.caughtUpDetail")}
              </p>
            </div>
          ) : (
            <ul className="max-h-[360px] min-h-0 divide-y divide-[var(--color-line)] overflow-y-auto">
              {preview.map((notification) => (
                <li key={notification.id}>
                  {notification.link ? (
                    <Link
                      href={notificationHref(notification) ?? notification.link}
                      onClick={() => {
                        void handleActivate(notification);
                        setOpen(false);
                      }}
                      className="block transition hover:bg-[var(--color-surface-soft)]"
                    >
                      <NotificationRow notification={notification} />
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleActivate(notification)}
                      className="block w-full text-left transition hover:bg-[var(--color-surface-soft)]"
                    >
                      <NotificationRow notification={notification} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex shrink-0 justify-center border-t border-[var(--color-line)] px-5">
            <Link
              href="/account/notifications"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary)]"
            >
              {t("platform.notifications.viewAll")}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
