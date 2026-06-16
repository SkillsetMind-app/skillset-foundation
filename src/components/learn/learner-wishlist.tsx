"use client";

import Image from "next/image";
import Link from "next/link";
import { BookmarkX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import type { WishlistItem } from "@/domain/wishlist";
import { getFeaturedCourseCards, type CourseCard } from "@/lib/data/catalog";
import {
  subscribeToPublishedTeacherCourses,
  teacherCourseToCourseCard,
} from "@/lib/data/published-courses";
import {
  subscribeToUserWishlist,
  toggleWishlistCourse,
} from "@/lib/data/wishlist";
import { getFirebaseClientConfig } from "@/lib/firebase/config";

export function LearnerWishlist() {
  const { user } = useAuth();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [publishedCourses, setPublishedCourses] = useState<CourseCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserWishlist(
      user.uid,
      (nextItems) => {
        setItems(nextItems);
        setError("");
        setIsLoading(false);
      },
      () => {
        setError("We could not load your saved courses.");
        setIsLoading(false);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!getFirebaseClientConfig()) {
      return;
    }

    return subscribeToPublishedTeacherCourses(
      (nextCourses) => {
        setPublishedCourses(nextCourses.map(teacherCourseToCourseCard));
      },
      () => {
        setError("Published courses could not load right now.");
      },
    );
  }, []);

  const courseBySlug = useMemo(() => {
    const next = new Map<string, CourseCard>();
    [...getFeaturedCourseCards(), ...publishedCourses].forEach((course) => {
      next.set(course.slug, course);
    });
    return next;
  }, [publishedCourses]);

  async function handleRemove(item: WishlistItem) {
    if (!user) {
      return;
    }

    setRemovingId(item.id);
    setError("");

    try {
      await toggleWishlistCourse({
        userId: user.uid,
        courseId: item.courseId,
        courseSlug: item.courseSlug,
      });
    } catch {
      setError("Could not update your wishlist. Please try again.");
    } finally {
      setRemovingId("");
    }
  }

  if (isLoading) {
    return (
      <div className="dash-card dash-card--strong p-5 text-sm text-[var(--color-ink-soft)]">
        Loading saved courses...
      </div>
    );
  }

  if (error) {
    return (
      <div className="dash-card dash-card--strong p-5">
        <p className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <section className="dash-card dash-card--strong p-5 sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Saved courses
        </p>
        <h2 className="display-title mt-3 max-w-2xl text-4xl leading-tight text-[var(--color-primary)]">
          Build your shortlist before you enroll.
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          Save courses from the marketplace and return here when you are ready
          to compare options or start learning.
        </p>
        <Link href="/courses" className="button-solid mt-6 inline-flex px-4 py-2.5 text-sm">
          Explore courses
        </Link>
      </section>
    );
  }

  return (
    <section className="grid gap-5 lg:grid-cols-2">
      {items.map((item) => {
        const course = courseBySlug.get(item.courseSlug) ?? courseBySlug.get(item.courseId);

        return (
          <article
            key={item.id}
            className="dash-card dash-card--strong overflow-hidden"
          >
            {course ? (
              <div className="grid gap-0 md:grid-cols-[220px_1fr]">
                <div className="relative min-h-[180px] overflow-hidden">
                  <Image
                    src={course.image}
                    alt={course.title}
                    fill
                    sizes="220px"
                    className="object-cover"
                  />
                </div>
                <div className="p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
                    {course.category}
                  </p>
                  <h3 className="display-title mt-3 text-3xl leading-tight text-[var(--color-primary)]">
                    {course.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                    {course.summary}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link
                      href={course.href ?? `/courses/${course.slug}`}
                      className="button-solid px-4 py-2.5 text-sm"
                    >
                      View course
                    </Link>
                    <button
                      type="button"
                      disabled={removingId === item.id}
                      onClick={() => void handleRemove(item)}
                      className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
                    >
                      {removingId === item.id ? "Removing..." : "Remove"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-5">
                <div className="grid size-12 place-items-center rounded-[14px] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                  <BookmarkX aria-hidden="true" size={22} />
                </div>
                <h3 className="display-title mt-4 text-3xl text-[var(--color-primary)]">
                  Saved course unavailable.
                </h3>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                  This saved course is not currently available in the catalog.
                  You can remove it from your wishlist.
                </p>
                <button
                  type="button"
                  disabled={removingId === item.id}
                  onClick={() => void handleRemove(item)}
                  className="button-outline mt-5 px-4 py-2.5 text-sm disabled:opacity-60"
                >
                  {removingId === item.id ? "Removing..." : "Remove"}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
