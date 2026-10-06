// The hourly "you have N new notifications" email
// (src/app/api/cron/notification-digest). Pure: the route fetches the rows,
// this decides who gets an email and which notifications it covers.

const MINUTE_MS = 60_000;

/** Younger than this, the person may still be on the site and see it in the bell. */
export const DIGEST_MIN_AGE_MS = 10 * MINUTE_MS;
// ponytail: older notifications are never emailed. Keeps the first run after
// deploy (and a run after a cron outage) from mailing a backlog nobody asked
// about; widen it if people miss notifications across a long weekend.
export const DIGEST_MAX_AGE_MS = 3 * 24 * 60 * MINUTE_MS;
/** At most one digest per person in this window. */
export const DIGEST_GAP_MS = 60 * MINUTE_MS;

export type DigestRow = {
  notification_id: string;
  user_id: string;
  created_at: string | null;
  read: boolean;
  emailed_at: string | null;
};

export type Digest = { userId: string; notificationIds: string[] };

/**
 * `rows` mixes the waiting notifications with the ones already emailed in the
 * last hour; the second kind only says "this person just got a digest".
 *
 * A row goes in when it is unread, never emailed, and between 10 minutes and
 * 3 days old. A person is left out when they got a digest less than an hour
 * ago or turned the digest off. Oldest waiting first, so whoever a capped run
 * leaves behind goes first next hour.
 */
export function selectDigests(
  rows: DigestRow[],
  optedOut: ReadonlySet<string>,
  now: number,
): Digest[] {
  const emailedRecently = new Set<string>();
  const due = new Map<string, { oldest: number; ids: string[] }>();

  for (const row of rows) {
    if (now - Date.parse(row.emailed_at ?? "") < DIGEST_GAP_MS) {
      emailedRecently.add(row.user_id);
    }
    const createdAt = Date.parse(row.created_at ?? "");
    const age = now - createdAt;
    if (row.read || row.emailed_at || !(age >= DIGEST_MIN_AGE_MS && age <= DIGEST_MAX_AGE_MS)) {
      continue;
    }
    const entry = due.get(row.user_id) ?? { oldest: createdAt, ids: [] };
    entry.oldest = Math.min(entry.oldest, createdAt);
    if (!entry.ids.includes(row.notification_id)) {
      entry.ids.push(row.notification_id);
    }
    due.set(row.user_id, entry);
  }

  return [...due]
    .filter(([userId]) => !emailedRecently.has(userId) && !optedOut.has(userId))
    .sort(([, a], [, b]) => a.oldest - b.oldest)
    .map(([userId, { ids }]) => ({ userId, notificationIds: ids }));
}

/** users.preferences.notifications.emailDigest — on unless explicitly false. */
export function digestTurnedOff(preferences: unknown): boolean {
  const notifications = (preferences as { notifications?: { emailDigest?: unknown } } | null)
    ?.notifications;
  return notifications?.emailDigest === false;
}
