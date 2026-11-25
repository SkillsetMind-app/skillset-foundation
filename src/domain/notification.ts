import { formatEventDateTime } from "@/domain/course-event";

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

// Where a notification leads. Almost always it is the stored `link` itself on the
// server. The exception is the teacher's message: the server stores
// "/learn/courses/<course>" (the whole classroom), but the reply lives in the learner's
// message inbox, which did not exist when the link was designed. Rewriting
// here (and not in a migration) keeps the old notifications right too.
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
  // Scheduled session notice: the database stores the whole classroom (the lessons tab),
  // but the session lives in the "Live sessions" tab. Only the classroom without a tab is rewritten.
  if (notification.type === "live_event") {
    const match = /^\/learn\/courses\/([^/?#]+)\/?$/.exec(link);
    if (match) {
      return `/learn/courses/${match[1]}/lives`;
    }
  }
  return link;
}

// The scheduled session notice (notify_enrolled_on_course_event) is stored in English
// and in UTC: "Live session scheduled: X" and "<product> — Nov 26, 2026 at 00:00
// UTC". The screen translates the title and rewrites the time in the language and time zone of whoever
// reads, with the same phrase as the other screens. It applies to the old notices too.
const LIVE_TITLE_PREFIX = "Live session scheduled: ";
const LIVE_BODY = /^([\s\S]*) — ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) at (\d{2}):(\d{2}) UTC$/;
const PG_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Text that does not match the database format appears as is.
export function notificationBody(
  notification: Pick<AppNotification, "type" | "body">,
  locale: string,
  timeZone?: string,
  now?: number,
): string {
  const match = notification.type === "live_event" ? LIVE_BODY.exec(notification.body) : null;
  const month = match ? PG_MONTHS.indexOf(match[2]) : -1;
  if (!match || month < 0) {
    return notification.body;
  }
  const [, product, , day, year, hour, minute] = match;
  const instant = new Date(Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute)));
  return `${product} — ${formatEventDateTime(instant.toISOString(), locale, notification.body, timeZone, now)}`;
}

// Old titles stored in English by the database (send_course_message). The
// message already existed before the translation; mapping the text here translates the old
// rows too, without a migration.
const legacyTitleKeys: Record<string, string> = {
  "New message from your teacher": "teacherMessage",
  "New student message": "studentMessage",
};

// The title in the language of whoever reads. The reply notices store an empty title and the
// ids in params (20261006041500_avisos_de_resposta.sql): the phrase is born here.
// A stored title appears as is (except the two English ones above and the one for the scheduled
// session, LIVE_TITLE_PREFIX).
export function notificationTitle(
  notification: Pick<AppNotification, "type" | "title" | "actorName" | "params">,
  t: (key: string) => string,
): string {
  const key = (id: string) => t("platform.notifications.types." + id);
  if (notification.title) {
    if (notification.type === "live_event" && notification.title.startsWith(LIVE_TITLE_PREFIX)) {
      const sessionTitle = notification.title.slice(LIVE_TITLE_PREFIX.length);
      return key("liveSessionScheduled").replace("{title}", () => sessionTitle);
    }
    const legacy = legacyTitleKeys[notification.title];
    return legacy ? key(legacy) : notification.title;
  }

  const actor = notification.actorName?.trim() || key("someone");
  // A function in replace: a name with "$&" does not become a replacement pattern.
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
