"use client";

import { Award } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { classroomTabHref, type ClassroomTab } from "@/domain/classroom-tabs";
import { useTranslation } from "@/components/i18n/i18n-provider";

// The last tab opened in this visit. Each tab is a route, so the classroom remounts
// on every switch; the module stays loaded during in-app navigation and resets on a
// fresh load. On the server nothing writes here (the effect does not run), so the first
// paint comes out the same on both sides.
let lastClassroomTab: ClassroomTab | null = null;

/**
 * true when the classroom opened by SWITCHING tabs, not by page load: only then the
 * panel enters with motion-panel-in. A load enters still, and what becomes the LCP
 * (cover, title, video) is never born with opacity 0.
 */
export function useTabChanged(tab: ClassroomTab): boolean {
  const [changed] = useState(() => lastClassroomTab !== null && lastClassroomTab !== tab);
  useEffect(() => {
    lastClassroomTab = tab;
  }, [tab]);
  return changed;
}

export type ClassroomTabItem = {
  id: ClassroomTab;
  label: string;
  count?: number;
};

// The classroom tab bar: Lesson · Materials · Lives · Community · Messages ·
// Review · About. Replaces the "Lesson tools" strip, whose buttons only scrolled the
// page. Each tab is a real <Link>: it goes into history, has an address,
// and can be shared. The current lesson travels in the address (?lesson=).
export function ClassroomTabs({
  basePath,
  active,
  lessonId,
  tabs,
  certificateHref,
}: {
  basePath: string;
  active: ClassroomTab;
  lessonId: string | null;
  tabs: ClassroomTabItem[];
  /** "Get certificate" used to live in the tools strip; it stays here, at the end of the
   *  bar, when the course is 100% (and outside whitelabel). */
  certificateHref?: string | null;
}) {
  const { t } = useTranslation();
  const navRef = useRef<HTMLElement>(null);

  // On the phone the bar scrolls sideways with the scrollbar hidden: "Review"
  // and "About" seemed not to exist. The open tab comes to the middle of the bar, and the
  // right edge fades while there is a tab hidden to the right.
  // It only touches the bar's own scrollLeft, never the page scroll.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && nav.scrollWidth > nav.clientWidth) {
      const bar = nav.getBoundingClientRect();
      const tab = current.getBoundingClientRect();
      nav.scrollLeft += tab.left - bar.left - (bar.width - tab.width) / 2;
    }
    const mark = () => {
      nav.dataset.more = String(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
    };
    mark();
    nav.addEventListener("scroll", mark, { passive: true });
    window.addEventListener("resize", mark);
    return () => {
      nav.removeEventListener("scroll", mark);
      window.removeEventListener("resize", mark);
    };
  }, [active]);

  return (
    <nav ref={navRef} aria-label={t("creatorEditor.preview.sections")} className="member-classroom-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={classroomTabHref(basePath, tab.id, lessonId)}
          aria-current={tab.id === active ? "page" : undefined}
        >
          {tab.label}
          {tab.count ? (
            <span className="member-classroom-tabs__count">{tab.count}</span>
          ) : null}
        </Link>
      ))}
      {certificateHref ? (
        <Link href={certificateHref} className="member-classroom-tabs__action">
          <Award size={15} aria-hidden />
          {t("learn.classroom.workspace.certificate")}
        </Link>
      ) : null}
    </nav>
  );
}
