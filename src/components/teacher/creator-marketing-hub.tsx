"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BadgePercent,
  Image,
  MessageCircle,
  Store,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformPageHeader } from "@/components/platform/platform-page-header";
import { Card, buttonClasses } from "@/components/ui";
import { groupCourseMessageThreads } from "@/domain/course-message";
import type { CourseMessage } from "@/domain/course-message";
import type { TeacherCourse } from "@/domain/teacher-course";
import { useStorefrontPath } from "@/components/teacher/use-storefront-path";
import { countCourseAssets } from "@/lib/data/course-assets";
import { subscribeToTeacherMessages } from "@/lib/data/course-messages";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";

// What the person suffered: this was the rawest screen in the panel — five rows of
// list with one button each and no state. The teacher opened Marketing and did not
// know if the storefront was live, how many messages were waiting for a reply or
// how many files they had in media; they had to enter each screen to
// find out. Now each card answers the question before the click, with data
// that already exists (no new server query was created for this).

type ToolCard = {
  key: string;
  title: string;
  description: string;
  href: string;
  action: string;
  icon: LucideIcon;
  /** The card's state line. `null` when the data does not exist cheaply. */
  state: ReactNode;
};

export function CreatorMarketingHub() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const uid = user?.uid ?? "";
  // /@user when the public profile has an @ (it is the link that goes in the bio).
  const storefrontPath = useStorefrontPath(uid);

  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [messages, setMessages] = useState<CourseMessage[] | null>(null);
  const [mediaFiles, setMediaFiles] = useState<number | null>(null);

  // Depends on the uid (string) and not on the user object: a new object on
  // every render would resubscribe the effects in a loop.
  useEffect(() => {
    if (!uid) {
      return;
    }

    return subscribeToTeacherCourses(
      uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setCoursesLoaded(true);
      },
      () => {
        setCoursesLoaded(true);
      },
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      return;
    }

    return subscribeToTeacherMessages(
      uid,
      setMessages,
      // With no loaded messages the card shows only the button: a wrong number is
      // worse than no number.
      () => setMessages(null),
    );
  }, [uid]);

  // The text key avoids redoing the count on every render because of the new
  // identity of the array coming from the subscription.
  const courseIdsKey = courses.map((course) => course.id).join(",");

  useEffect(() => {
    if (!uid || !coursesLoaded) {
      return;
    }

    let mounted = true;
    countCourseAssets(courseIdsKey ? courseIdsKey.split(",") : [])
      .then((count) => {
        if (mounted) {
          setMediaFiles(count);
        }
      })
      .catch(() => {
        if (mounted) {
          setMediaFiles(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, [uid, coursesLoaded, courseIdsKey]);

  const publishedCount = courses.filter(
    (course) => course.status === "published",
  ).length;
  // The storefront always exists; what changes is whether something is published on it. Saying "live"
  // with zero courses would be a lie, and it is the same rule as the Home card.
  const isPublished = publishedCount > 0;

  const awaitingReply = useMemo(() => {
    if (messages === null) {
      return null;
    }

    return groupCourseMessageThreads(messages).filter(
      (thread) => thread.lastMessage.senderId !== uid,
    ).length;
  }, [messages, uid]);

  const tools: ToolCard[] = [
    {
      key: "storefront",
      title: t("teach.marketing.storefront.title"),
      description: t("teach.marketing.storefront.description"),
      href: "/teach/storefront",
      action: t("teach.marketing.storefront.action"),
      icon: Store,
      state: !coursesLoaded ? (
        <span className="text-xs text-[var(--color-ink-muted)]">
          {t("teach.marketing.checking")}
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={`status-chip ${isPublished ? "status-chip--success" : "status-chip--draft"}`}
          >
            <span className="status-chip__dot" aria-hidden="true" />
            {t(
              isPublished
                ? "teach.marketing.state.published"
                : "teach.marketing.state.notPublished",
            )}
          </span>
          {uid ? (
            <Link
              href={storefrontPath}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] underline underline-offset-2 pointer-coarse:min-h-11"
            >
              {t("teach.marketing.state.openPublicPage")}
            </Link>
          ) : null}
        </span>
      ),
    },
    {
      key: "media",
      title: t("teach.marketing.media.title"),
      description: t("teach.marketing.media.description"),
      href: "/teach/media",
      action: t("teach.marketing.media.action"),
      icon: Image,
      state:
        mediaFiles === null ? null : (
          <span className="text-xs font-semibold tabular-nums text-[var(--color-ink-soft)]">
            {t(
              mediaFiles === 1
                ? "teach.marketing.state.filesOne"
                : "teach.marketing.state.filesMany",
            ).replace("{count}", String(mediaFiles))}
          </span>
        ),
    },
    {
      key: "messages",
      title: t("teach.marketing.messages.title"),
      description: t("teach.marketing.messages.description"),
      href: "/teach/messages",
      action: t("teach.marketing.messages.action"),
      icon: MessageCircle,
      state:
        awaitingReply === null ? null : (
          <span className="text-xs font-semibold tabular-nums text-[var(--color-ink-soft)]">
            {awaitingReply === 0
              ? t("teach.marketing.state.noAwaitingReply")
              : t(
                  awaitingReply === 1
                    ? "teach.marketing.state.awaitingReplyOne"
                    : "teach.marketing.state.awaitingReplyMany",
                ).replace("{count}", String(awaitingReply))}
          </span>
        ),
    },
    {
      key: "coupons",
      title: t("teach.marketing.coupons.title"),
      description: t("teach.marketing.coupons.description"),
      // Coupon lives inside each product: the card leads to the product
      // list and says so on the button. (/teach/coupons only redirects.)
      href: "/teach/builder",
      action: t("teach.marketing.coupons.action"),
      icon: BadgePercent,
      // There is no creator-level coupon to count without a new query. The card
      // says where the setting lives, with no number.
      state: (
        <span className="text-xs text-[var(--color-ink-soft)]">
          {t("teach.marketing.state.couponsPerProduct")}
        </span>
      ),
    },
    // "Integrations — See what's planned" is gone: there is no integrations page,
    // and the old address lands on Earnings.
  ];

  return (
    <div className="grid gap-7">
      <PlatformPageHeader
        eyebrow={t("teach.marketing.eyebrow")}
        title={t("teach.marketing.title")}
        description={t("teach.marketing.description")}
      />

      <section aria-labelledby="marketing-tools-title">
        {/* The "5 tools" is gone: the grid already says how many there are, and the space is worth more
            for each card's state. */}
        <h2 id="marketing-tools-title" className="text-lg font-semibold text-[var(--color-ink)]">
          {t("teach.marketing.sectionTitle")}
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tools.map((tool) => {
            const Icon = tool.icon;

            return (
              <Card
                key={tool.key}
                as="article"
                padding="md"
                className="flex flex-col gap-3"
              >
                <span className="grid size-10 place-items-center rounded-md border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                  <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-ink)]">{tool.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
                    {tool.description}
                  </p>
                </div>
                {tool.state ? <div>{tool.state}</div> : null}
                {/* mt-auto: the four buttons of the row stay on the same line,
                    at the foot of the card, instead of a staircase right below each
                    text. */}
                <Link
                  href={tool.href}
                  className={`${buttonClasses({ variant: "outline", size: "sm" })} mt-auto self-start`}
                >
                  {tool.action}
                  <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
                </Link>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
