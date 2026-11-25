"use client";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { HelpMenu, type HelpCourse } from "@/components/platform/help-menu";
import { NotificationBell } from "@/components/platform/notification-bell";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { AccountMenu } from "@/components/site/account-menu";
import { AdvisorHeaderSlot } from "@/components/teacher/advisor-sidebar";
import type { MembersTheme } from "@/domain/teacher-course";
import { isStorefrontHexColor, readableTextOnAccent } from "@/domain/user-profile";
import { ThemeProvider } from "@/lib/theme/theme-provider";

/**
 * The teacher's mark, when their plan includes `removePlatformBranding`. The
 * page resolves it server-side and passes it down; leaving it undefined keeps
 * the SkillsetMind wordmark, which is the correct default for every plan below
 * pro and for any lookup that fails.
 */
export type MemberAreaBrand = {
  name: string;
  logoUrl?: string | null;
  accentColor?: string | null;
};

// Member area = its own destination, structurally separate from the dashboard
// PlatformShell (no sidebar/rail). Parity with Hotmart's Club: an enrolled
// course opens as a standalone, Netflix-style surface instead of being embedded
// in the platform chrome — which read as "two layouts mixed together".
// EnrolledCourseWorkspace is already self-contained (own hero, player,
// curriculum); this shell only frames it with a slim top bar and a centered
// container so the members-area card isn't edge-to-edge.
//
// data-members-theme on THIS root is the load-bearing bit: globals.css declares
// the --ma-* palette on a bare `[data-members-theme="dark"]` selector, so the
// tokens inherit into the whole page instead of stopping at the inner
// .member-classroom card — which is why the shell used to stay light around a
// dark classroom.
export function MemberAreaShell({
  children,
  brand,
  theme = "light",
  course = null,
}: {
  children: ReactNode;
  brand?: MemberAreaBrand | null;
  /** null = the theme is not known yet (the creator's area is loading). */
  theme?: MembersTheme | null;
  /** This room's course: Help sends the lesson question to its community
   *  (or to the message to the teacher, if the community is off). */
  course?: HelpCourse | null;
}) {
  // Same guard-then-inline shape as the storefront hero: the projection already
  // sanitizes the value, this is the cheap second gate before it lands in a CSS
  // custom property. Scoped to this subtree, so it only overrides the platform
  // red inside the member area.
  const accentColor =
    brand?.accentColor && isStorefrontHexColor(brand.accentColor)
      ? brand.accentColor
      : null;

  // Unknown theme (null): the same shell, header included (brand, Help,
  // bell, account: the way out stays on screen if the read is slow), with the
  // "pending" palette from globals.css, which reads the PLATFORM tones. It is the same background as the
  // "loading" notice of the login that comes before. Painting light here made the
  // dark area be born light and turn dark a moment later.
  const pending = theme === null;

  return (
    <ThemeProvider>
      <div
        data-members-theme={pending ? "pending" : theme}
        className="flex min-h-screen flex-col bg-[var(--ma-bg)] text-[var(--ma-ink)]"
        style={
          accentColor
            ? ({
                "--ma-accent": accentColor,
                // The accent is a FILL under text: the text colour comes from
                // the accent itself, and hover keeps the accent instead of
                // falling back to the platform red under that text.
                "--ma-accent-hover": accentColor,
                "--ma-on-accent": readableTextOnAccent(accentColor),
              } as CSSProperties)
            : undefined
        }
      >
        <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-[var(--ma-line)] bg-[var(--ma-bg-top)] px-4 py-3 sm:px-6">
          {brand ? (
            // Whitelabel: the teacher's mark carries no link of ours. The
            // student still gets Help, the bell and the account menu below:
            // a class with no way to reach messages or support is a dead end.
            brand.logoUrl ? (
              <span className="relative block h-8 w-32">
                <Image
                  src={brand.logoUrl}
                  alt={brand.name}
                  fill
                  sizes="128px"
                  className="object-contain object-left"
                  unoptimized
                />
              </span>
            ) : (
              <span className="text-lg font-semibold text-[var(--ma-ink)]">
                {brand.name}
              </span>
            )
          ) : (
            // tone fixed by the COURSE theme: the --ma-* palette does not follow the
            // <html>, so "auto" painted the logo navy in the dark header.
            // While the theme has not arrived (pending) the shell uses the platform
            // tones, and there "auto" is right.
            // The logo leads to "My courses", not to the public home: whoever
            // is studying wants to go back to their courses, not to the storefront.
            <LogoWordmark href="/learn" nav tone={pending ? "auto" : theme === "dark" ? "dark" : "light"} />
          )}
          <div className="flex shrink-0 items-center gap-2 empty:hidden">
            <AdvisorHeaderSlot />
            {/* Help, bell and account, here too — including in the room with the
                teacher's brand. Before, the room had only the logo (and, without a brand,
                the bell): to reach messages, purchases or support the learner
                had to leave through "← My courses", and with the teacher's brand
                not even the bell appeared, even though the messages panel says the
                reply "lands in the bell". The way out of the room stays ONE: "← My
                courses", on the cover or in the lesson's short header. */}
            <HelpMenu variant="bar" side="student" course={course} />
            <MemberAreaAccount branded={Boolean(brand)} />
          </div>
        </header>
        {/* No side gutter below md: on a phone the classroom runs edge to edge
            so the lesson video can too (globals.css, .member-video-dock). The
            cards inside keep their own padding for text. */}
        <main className="mx-auto w-full max-w-[1280px] flex-1 py-6 md:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </ThemeProvider>
  );
}

function MemberAreaAccount({ branded }: { branded: boolean }) {
  const { status, user, signOut } = useAuth();

  return (
    <>
      <NotificationBell />
      {status === "authenticated" && user ? <AccountMenu user={user} onSignOut={signOut} branded={branded} /> : null}
    </>
  );
}
