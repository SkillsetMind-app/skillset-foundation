// The classroom tabs, each with its own address.
//
// POR QUE ISTO EXISTE
//
// Materials, community, messages and review lived in the same scroll as the
// lesson, after the curriculum, with no address: you could not send the link to the
// course community or go back to it through history. And the "Current
// lesson / Materials / Discussion" buttons only scrolled the page: they looked like navigation and
// led nowhere. Now each tab is a path
// (/learn/courses/<course>/community?lesson=<lesson>): clicking opens it, the browser's back
// button returns the lesson, the link is shareable. The current lesson stays in the
// address on every tab, so "back to the lesson" is always the same lesson.

export const CLASSROOM_TABS = [
  "lesson",
  "materials",
  "lives",
  "community",
  "messages",
  "review",
  "about",
] as const;

export type ClassroomTab = (typeof CLASSROOM_TABS)[number];

export function isClassroomTab(value: string): value is ClassroomTab {
  return (CLASSROOM_TABS as readonly string[]).includes(value);
}

/** The classroom path without the tab: "/learn/courses/<course>". On a lesson, it is
 *  the pathname itself; on a tab, it removes the "/<tab>" at the end, and whatever comes after
 *  it (the drawer: "/community/q/<post>"). */
export function classroomBasePath(pathname: string, tab: ClassroomTab): string {
  if (tab === "lesson") {
    return pathname;
  }
  // Only the drawer (/q/<post>) may come after the tab. A generic "/.*" here
  // swallowed everything from the FIRST "/community" on: a course with the slug "community"
  // lost its slug along with the tab.
  return pathname.replace(new RegExp(`/${tab}(?:/q/[^/]+)?$`), "");
}

/** The address of a tab, carrying the current lesson along (?lesson=). The
 *  "lesson" tab is the base itself, with no segment. */
export function classroomTabHref(
  basePath: string,
  tab: ClassroomTab,
  lessonId: string | null,
): string {
  const path = tab === "lesson" ? basePath : `${basePath}/${tab}`;
  return lessonId ? `${path}?lesson=${encodeURIComponent(lessonId)}` : path;
}
