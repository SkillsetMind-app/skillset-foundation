// Placeholders shaped like what is coming, for the screens that used to wait with a
// loose sentence in a card (or with nothing). The text is left for the screen reader, in a
// single role="status"; the blocks are aria-hidden. No hook and no "use client": it serves
// both server and client. A single bone tone, the one used by the house skeletons
// (BuilderSkeleton).
const tone = "bg-[var(--color-surface-strong)]";
const bone = `rounded-md ${tone}`;
const card = "rounded-lg border border-[var(--color-line)] bg-white shadow-[var(--shadow-soft)]";

/**
 * The platform shell while the session resolves (F-03, stage 0): it used to be a
 * ring in the middle of an empty page and then the sidebar, the top bar and the
 * content all came in at once. The measurements do not live here: each piece uses the
 * SAME class as the PlatformShell (`.platform-grid` and its modifiers give the
 * sidebar width, `.platform-topbar__inner` the top bar height,
 * `.platform-content` the breathing room, `.platform-mobile-nav` the phone's
 * bottom bar), so swapping in the real shell moves nothing. Inert: no
 * link, no button, no menu name or label; a single role="status", with the
 * previous sentence for the screen reader. The sidebar stays in its navy only:
 * the light bone painted over the navy would be a second tone.
 */
export function PlatformShellSkeleton({
  label,
  collapsed,
  auto,
  framed,
}: {
  label: string;
  collapsed: boolean;
  auto: boolean;
  /** The 1280px column of the studio, account and learner list screens. */
  framed: boolean;
}) {
  return (
    <main className="page-shell platform-shell-root">
      <div className="platform-shell-body">
        <div className="platform-shell-inner w-full">
          <div
            className={[
              "platform-grid",
              collapsed ? "platform-grid--collapsed" : "",
              auto ? "platform-grid--auto" : "",
            ].join(" ")}
          >
            <aside
              aria-hidden="true"
              className={`platform-sidebar platform-sidebar-panel ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}
            >
              <div className="platform-sidebar-brand" />
            </aside>
            <div className="platform-main-column">
              <div aria-hidden="true" className="platform-topbar">
                <div className="platform-topbar__inner motion-safe:animate-pulse">
                  {/* The brand only on the phone and the path only from 768px up,
                      as in the real top bar. */}
                  <span className={`platform-topbar__logo size-10 ${bone}`} />
                  <span className={`hidden h-4 w-48 md:block ${bone}`} />
                  <span className="platform-topbar__actions">
                    {[0, 1, 2].map((item) => (
                      <span key={item} className={`size-10 rounded-full ${tone}`} />
                    ))}
                  </span>
                </div>
              </div>
              <section className="platform-content">
                <div
                  role="status"
                  className={["space-y-6", framed ? "mx-auto w-full min-[1440px]:max-w-7xl" : ""].join(" ")}
                >
                  {/* The ring had the sentence in a visible h1: whoever moves through the
                      headings with the screen reader still finds one. */}
                  <h1 className="sr-only">{label}</h1>
                  <div aria-hidden="true" className="border-b border-[var(--color-line)] pb-5 pt-2 motion-safe:animate-pulse">
                    <div className={`h-9 w-72 max-w-full ${bone}`} />
                  </div>
                  <div aria-hidden="true" className="grid gap-4 motion-safe:animate-pulse">
                    {[0, 1, 2].map((item) => (
                      <div key={item} className={`p-4 sm:p-5 ${card}`}>
                        <div className={`h-5 w-2/3 max-w-md ${bone}`} />
                        <div className={`mt-4 h-4 w-1/2 max-w-sm ${bone}`} />
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
      {/* The phone's bottom bar: the class only shows it below 768px. */}
      <div aria-hidden="true" className="platform-mobile-nav motion-safe:animate-pulse">
        {[0, 1, 2, 3, 4].map((item) => (
          <span key={item} className="grid min-w-0 flex-1 place-items-center gap-1 px-2 py-2">
            <span className={`size-5 ${bone}`} />
            <span className={`h-2.5 w-10 ${bone}`} />
          </span>
        ))}
      </div>
    </main>
  );
}

/**
 * The learner area's card lists (certificates, live sessions,
 * communities): the top row and two cards side by side. `head` is what
 * sits on top in the finished screen: the filters or the section title.
 */
export function CardListSkeleton({ label, head }: { label: string; head: "tabs" | "title" }) {
  return (
    <div role="status" className="grid gap-5">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={`${head === "tabs" ? "h-11 w-72" : "h-5 w-32"} max-w-full animate-pulse ${bone}`} />
      <div aria-hidden="true" className="grid animate-pulse gap-4 lg:grid-cols-2">
        {[0, 1].map((item) => (
          <div key={item} className={`p-4 sm:p-5 ${card}`}>
            <div className={`h-5 w-2/3 ${bone}`} />
            <div className={`mt-4 h-4 w-1/2 ${bone}`} />
            <div className={`mt-4 h-11 w-32 ${bone}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
