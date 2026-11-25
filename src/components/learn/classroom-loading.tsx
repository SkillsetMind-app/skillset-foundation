// The ONLY waiting screen of the classroom.
//
// Opening a course went through up to four: the route file's (dark, with the
// courses appearing light), the Suspense one, a white card in the creator's
// workspace and the workspace skeleton. Now all four are this one.
//
// No "use client" and no hooks: the route file (server) and the workspaces
// (client) draw the same markup, and the caller translates the text. --ma-* colors
// with a fallback to the platform's: inside the members area shell the course
// theme applies; in the route file, before the shell and with no known theme, the
// platform's neutral colors apply.
//
// `short`: whoever already knows the lesson opens with the short header (52px, lesson in the
// address) asks for the top block at that height; without it, it has the height of the
// course cover (members-hero, globals.css), which is what a first visit sees.
export function ClassroomLoading({ label, short = false }: { label: string; short?: boolean }) {
  const block = "animate-pulse bg-[var(--ma-line,var(--color-surface-strong))]";

  return (
    // px-4 only on the phone: below md the shell has no side margin (the classroom
    // goes edge to edge), and the wait touched the screen edge.
    <section aria-busy="true" className="grid gap-4 px-4 md:px-0">
      <p role="status" className="text-sm text-[var(--ma-ink-soft,var(--color-ink-soft))]">
        {label}
      </p>
      {/* The corners of the real cards (12px; 8px on the list rows):
          with square corners, everything "changed shape" when the course arrived. */}
      <div
        className={`${short ? "h-[52px]" : "min-h-[clamp(300px,min(43vw,48svh),520px)]"} rounded-lg ${block}`}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className={`aspect-video rounded-lg ${block}`} />
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className={`h-16 rounded-md ${block}`} />
          ))}
        </div>
      </div>
    </section>
  );
}
