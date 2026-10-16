export type NotificationType =
  | "community_question"
  | "community_comment"
  | "community_reply"
  | "support_reply"
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
  // Ids of the event (postId, commentId, category, ticketId). The reply types
  // store an empty title and the screen builds the sentence from type + params
  // + actorName in the reader's language — see notificationTitle.
  params?: Record<string, unknown> | null;
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

// Titulos antigos gravados em ingles pelo banco (send_course_message). A
// mensagem ja existia antes da traducao; mapear o texto aqui traduz as linhas
// antigas tambem, sem migration.
const legacyTitleKeys: Record<string, string> = {
  "New message from your teacher": "teacherMessage",
  "New student message": "studentMessage",
};

// O titulo no idioma de quem le. Os avisos de resposta gravam title vazio e os
// ids em params (20261006041500_avisos_de_resposta.sql): a frase nasce aqui.
// Titulo gravado aparece como esta (fora os dois ingleses acima).
export function notificationTitle(
  notification: Pick<AppNotification, "type" | "title" | "actorName" | "params">,
  t: (key: string) => string,
): string {
  const key = (id: string) => t("platform.notifications.types." + id);
  if (notification.title) {
    const legacy = legacyTitleKeys[notification.title];
    return legacy ? key(legacy) : notification.title;
  }

  const actor = notification.actorName?.trim() || key("someone");
  // Funcao no replace: um nome com "$&" nao vira padrao de substituicao.
  const withName = (id: string) => key(id).replace("{name}", () => actor);
  switch (notification.type) {
    case "community_question":
      return withName("communityQuestion");
    case "community_comment":
      return withName(
        notification.params?.category === "question" ? "answeredQuestion" : "repliedPost",
      );
    case "community_reply":
      return withName("repliedThread");
    case "support_reply":
      return key("supportReply");
    default:
      return "";
  }
}
