export type NotificationType =
  | "community_comment"
  | "community_reply"
  | "enrollment"
  | "course_review"
  | "certificate"
  | "live_event"
  | "course_message";

// Named `AppNotification` (not `Notification`) on purpose: `Notification` is a
// DOM global, and shadowing it inside client components is a footgun. Rows
// live in `notifications`, scoped by user_id — server-written, owner-read
// under RLS, and the owner may only flip `read`.
export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  // In-app destination for the bell/inbox row. Null = no navigation target.
  link?: string | null;
  // Display name of whoever triggered the event (a commenter / reviewer). Null
  // for system events (enrollment / certificate). NEVER an email — producers
  // pass the same "SkillsetMind member" fallback used across the community.
  actorName?: string | null;
  // Server-written creation time: an ISO string from Postgres, or the legacy
  // { seconds } shape on un-migrated rows. Optional so a row renders even when
  // it is absent — see formatNotificationTime, which accepts both.
  createdAt?: unknown;
};

// Para onde uma notificacao leva. Quase sempre e o proprio `link` gravado no
// servidor. A excecao e a mensagem do professor: o servidor grava
// "/learn/courses/<curso>" (a sala inteira), mas a resposta mora na caixa de
// mensagens do aluno — que nao existia quando o link foi desenhado. Reescrever
// aqui (e nao numa migration) mantem as notificacoes antigas certas tambem.
export function notificationHref(
  notification: Pick<AppNotification, "type" | "link">,
): string | null {
  const link = notification.link ?? null;
  if (!link) {
    return null;
  }
  if (notification.type === "course_message") {
    const match = /^\/learn\/courses\/([^/?#]+)/.exec(link);
    if (match) {
      return "/learn/messages?course=" + match[1];
    }
  }
  return link;
}
