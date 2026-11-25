import { describe, expect, it } from "vitest";

import { notificationBody, notificationHref, notificationTitle } from "@/domain/notification";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// Reanalysis item 12: the teacher's reply opens the learner's
// message inbox, not the whole classroom. The server stores "/learn/courses/<course>" in the
// link; the rule rewrites it on the client (it applies to the old notifications too).

describe("where the notification leads", () => {
  it("teacher message: from the whole classroom to that course's conversation", () => {
    expect(
      notificationHref({ type: "course_message", link: "/learn/courses/course-1" }),
    ).toBe("/learn/messages?course=course-1");
    expect(
      notificationHref({ type: "course_message", link: "/learn/courses/course-1?lesson=l2" }),
    ).toBe("/learn/messages?course=course-1");
  });

  it("a message with no course in the link (the server stored /learn) stays as it is", () => {
    expect(notificationHref({ type: "course_message", link: "/learn" })).toBe("/learn");
  });

  it("session scheduled: from the whole classroom to the live sessions tab", () => {
    expect(notificationHref({ type: "live_event", link: "/learn/courses/course-1" })).toBe(
      "/learn/courses/course-1/lives",
    );
    // A link that already points to a tab stays as it is.
    expect(notificationHref({ type: "live_event", link: "/learn/courses/course-1/community" })).toBe(
      "/learn/courses/course-1/community",
    );
  });

  it("the other types do not change, and with no link there is no destination", () => {
    expect(
      notificationHref({ type: "community_reply", link: "/learn/courses/course-1/community" }),
    ).toBe("/learn/courses/course-1/community");
    expect(notificationHref({ type: "certificate", link: null })).toBeNull();
  });
});

// The database stores the session notice in English and in UTC
// (notify_enrolled_on_course_event): the learner in Los Angeles read "Nov 26 at
// 00:00 UTC" for a session that, for her, was the 25th at 4 PM.
describe("scheduled session notice in the language and time zone of whoever reads", () => {
  const plain = (text: string) => text.replace(/\s+/g, " ");
  const stored = { type: "live_event" as const, body: "Mindful leadership — Nov 26, 2026 at 00:00 UTC" };

  // Fixed "now": the year only appears when it is not the current one.
  const in2026 = Date.UTC(2026, 10, 22, 12);

  it("rewrites the date in the text with the phrase used by the other screens", () => {
    expect(plain(notificationBody(stored, "en", "America/Los_Angeles", in2026))).toBe(
      "Mindful leadership — Wed, Nov 25, 4:00 PM PT",
    );
    expect(plain(notificationBody(stored, "es", "America/Los_Angeles", in2026))).toBe(
      "Mindful leadership — mié, 25 nov, 16:00 hora del Pacífico",
    );
    // Day with a leading zero (the database writes "Mar 05"), product with an em dash
    // and another year.
    expect(plain(notificationBody(
      { type: "live_event", body: "Calm — a course — Mar 05, 2027 at 15:30 UTC" },
      "en",
      "America/New_York",
      in2026,
    ))).toBe("Calm — a course — Fri, Mar 5, 2027, 10:30 AM ET");
  });

  it("text that does not match the database format appears as is", () => {
    for (const body of ["Mindful leadership — 2026-11-26T00:00:00Z", "Mindful leadership — Foo 26, 2026 at 00:00 UTC", ""]) {
      expect(notificationBody({ type: "live_event", body }, "es", "America/Los_Angeles")).toBe(body);
    }
    // Another kind of notice with the same format is not touched.
    expect(notificationBody({ ...stored, type: "enrollment" }, "es", "America/Los_Angeles")).toBe(stored.body);
  });

  it("translates the title stored in English and keeps the session name literal", () => {
    const t = (key: string) => translate(getDictionary("es"), key);
    expect(notificationTitle({ type: "live_event", title: "Live session scheduled: Q&A $& live" }, t)).toBe(
      "Sesión en vivo programada: Q&A $& live",
    );
    expect(notificationTitle({ type: "live_event", title: "Something else" }, t)).toBe("Something else");
  });
});
