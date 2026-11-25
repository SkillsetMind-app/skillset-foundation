"use client";

import type { ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  groupCourseReadiness,
  type CourseReadiness,
  type CourseReadinessItem,
} from "@/domain/course-readiness";
import { cn } from "@/lib/cn";

// The "N of M" bar added up the title, cover and Stripe payout as if they were the
// same thing. Hotmart separates them into three states (content saved, page
// prepared, sale available) and the person sees where they are stuck. This is only
// the grouping with a title and a count; each screen still draws the item
// its own way (the builder in a box, Manage in a line with the verification
// link), so the item comes through a render prop and not fixed markup.
export function ReadinessGroups({
  readiness,
  renderItem,
  className,
}: {
  readiness: Pick<CourseReadiness, "items">;
  renderItem: (item: CourseReadinessItem) => ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className={cn("grid-cols-1", className)}>
      {groupCourseReadiness(readiness).map((group) => (
        <section key={group.id} data-readiness-group={group.id}>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
            <span className={group.ready ? "text-[var(--color-primary)]" : "text-[var(--color-ink)]"}>
              {t(`creatorEditor.readiness.groups.${group.id}`)}
            </span>
            {/* A group with no items (the sale of a free product) used to say "0 of 0". */}
            {group.total > 0
              ? ` · ${t("creatorEditor.readiness.groupCount")
                .replace("{done}", () => String(group.doneCount))
                .replace("{total}", () => String(group.total))}`
              : null}
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-3">{group.items.map(renderItem)}</ul>
        </section>
      ))}
    </div>
  );
}
