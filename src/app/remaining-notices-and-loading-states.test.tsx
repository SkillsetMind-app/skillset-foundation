import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardListSkeleton } from "@/components/shared/page-skeletons";

// Source reads, as in teacher-account-notices.test.ts: jsdom does not paint
// anything, so what can be proven is that the house piece is in place and the hand-made
// one did not come back.
const read = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");
const handRedBox = "bg-[rgba(178,34,52,0.06)]";

describe("F-07: the last hand-made red boxes became the house notice", () => {
  it.each([
    "components/auth/auth-provider.tsx",
    "components/auth/loading-screen.tsx",
    "components/auth/onboarding-choice.tsx",
    "components/auth/onboarding-wizard.tsx",
    "components/auth/reset-password-form.tsx",
    "components/auth/turnstile-widget.tsx",
    "components/certificates/certificate-verification-panel.tsx",
    "components/support/support-ticket-center.tsx",
    // Earnings: the box at the top and the red sentence of the account block.
    "components/teacher/teacher-wallet-panel.tsx",
    // Loose red sentences that became the house notice.
    "components/teacher/activation-checkout-panel.tsx",
    "components/teacher/custom-domains-panel.tsx",
    // The two failure chips of the builder's save and the members area cover.
    "components/teacher/course-builder-studio.tsx",
    "components/teacher/member-area-settings-panel.tsx",
    // The error of the covers and of the sales page image lives in the single shell.
    "components/teacher/image-upload-field.tsx",
    // Purchase: without an account, the thank-you page and the embedded checkout error.
    "components/courses/guest-checkout-form.tsx",
    "components/courses/guest-access-link.tsx",
    "components/account/embedded-checkout-panel.tsx",
  ])("%s uses the error InlineAlert", (file) => {
    const source = read(file);
    expect(source).not.toContain(handRedBox);
    expect(source).toContain('<InlineAlert tone="error"');
  });

  // The delete confirmation is not an error (it does not become an alert), but the background is the
  // token: the literal 6% disappeared in the dark theme.
  it("the community delete confirmation uses the background token", () => {
    const source = read("components/learn/community-item-actions.tsx");
    expect(source).not.toContain(handRedBox);
    expect(source).toContain("bg-[var(--color-danger-soft)]");
  });
});

describe("F-09: barras de progresso", () => {
  it("os passos do onboarding usam a barra compartilhada", () => {
    expect(read("components/auth/onboarding-choice.tsx")).toContain("<ProgressBar");
  });

  it("the two native upload bars use the house bar tokens", () => {
    expect(read("components/teacher/lesson-content-modal.tsx")).toContain('<progress className="upload-progress"');
    expect(read("components/teacher/lesson-upload-provider.tsx")).toContain('<progress className="upload-progress mt-2"');
    const css = read("app/globals.css");
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf("}", at));
    };
    expect(rule(".upload-progress[value]")).toContain("background: var(--color-line)");
    expect(rule(".upload-progress[value]::-webkit-progress-value")).toContain("background: var(--color-accent-fg)");
    expect(rule(".upload-progress[value]::-moz-progress-bar")).toContain("background: var(--color-accent-fg)");
  });

  it("the dead CSS of the old curriculum bar is gone", () => {
    expect(read("app/globals.css")).not.toContain("member-curriculum-progress");
  });

  // The classroom top bar, the cover one and the one on the upload note were hand-made
  // (the note's in 8px navy): now they are the shared ProgressBar.
  it.each([
    "components/learn/enrolled-course-workspace.tsx",
    "components/learn/members-area-hero.tsx",
    "components/teacher/upload-progress-note.tsx",
    // The signup and interview dots (on the signup path).
    "components/auth/signup-form.tsx",
    "components/auth/onboarding-progress.tsx",
  ])("%s usa a barra compartilhada", (file) => {
    const source = read(file);
    expect(source).toContain("<ProgressBar");
    expect(source).not.toMatch(/style=\{\{ width: `\$\{/);
  });

  it("the CSS of the hand-made bars is gone (classroom, cover and module card fill)", () => {
    const css = read("app/globals.css");
    expect(css).not.toContain(".member-classroom-head__progress > span");
    expect(css).not.toContain(".members-hero__bar > span");
    expect(css).not.toContain("member-module-card__bar");
  });
});

describe("F-03 / I-3: waits with a shape, and the routes that answer right away", () => {
  it("the members area answers right away with its own skeleton", () => {
    expect(existsSync(join(process.cwd(), "src", "app/learn/areas/[criador]/loading.tsx"))).toBe(true);
    expect(read("app/learn/areas/[criador]/loading.tsx")).toContain("<MemberAreaHomeSkeleton");
  });

  // /teach/activate and the return from Stripe answer 307 on the server when there is
  // nothing to pay; a loading.tsx would send the frame first (200) and the redirect
  // would turn into a jump in the browser, on the page Stripe sends people back to.
  it.each(["app/teach/activate/loading.tsx", "app/teach/activate/return/loading.tsx"])("%s does not exist", (file) => {
    expect(existsSync(join(process.cwd(), "src", file))).toBe(false);
  });

  // Community (two sentences in a row), favorites, materials and ranking used to wait
  // with a loose sentence: now the shape of what is coming, and the sentence only for the reader.
  it.each([
    ["components/learn/community-feed.tsx", "learn.community.loading"],
    ["components/learn/community-feed.tsx", "learn.community.feedLoading"],
    ["components/learn/learner-wishlist.tsx", "learnWave2.wishlistHub.loading"],
    ["components/learn/course-materials-panel.tsx", "learn.classroom.resources.loading"],
    ["components/learn/community-leaderboard.tsx", "learnWave2.leaderboard.loading"],
  ])("%s waits with a shape (%s only for the screen reader)", (file, key) => {
    const source = read(file);
    const sentence = source.indexOf(`t("${key}")`);
    expect(sentence, key).toBeGreaterThan(-1);
    // The sentence lives in an sr-only (directly, or as the `label` of a screen skeleton).
    expect(source.slice(Math.max(0, sentence - 120), sentence)).toMatch(/sr-only|label=\{$/);
  });

  it("the learner's message box does not wait blank", () => {
    expect(read("app/learn/messages/page.tsx")).not.toContain("fallback={null}");
  });

  it.each(["tabs", "title"] as const)("the card list (%s): one notice, with no title or button", (head) => {
    render(<CardListSkeleton label="Loading credentials..." head={head} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading credentials...");
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("I-2: one house ring, which stops for those who asked for less motion", () => {
  it("the shared ring has a track that shows in the dark theme and spins only in no-preference", () => {
    const source = read("components/shared/skillset-spinner.tsx");
    // The navy at a fixed 12% disappeared on the dark background, in the wait of every protected page.
    expect(source).not.toContain("rgba(26,54,93,0.12)");
    expect(source).toContain("border-[var(--color-line)] border-t-[var(--color-accent-fg)] motion-safe:animate-spin");
  });

  it("the payment return uses the house ring, with no hand-made copy", () => {
    const source = read("components/account/billing-return-status.tsx");
    expect(source).toContain('<SpinnerRing size="sm" />');
    expect(source).not.toMatch(/rounded-full border-2[^"]*animate-spin/);
  });

  // Without `motion-safe:` the ring spun even with "reduce motion" on.
  it.each(["components/ui/button.tsx", "components/shared/protected-asset-preview.tsx", "components/shared/skillset-spinner.tsx", "components/account/billing-return-status.tsx"])(
    "%s does not spin without motion-safe",
    (file) => {
      expect(read(file)).not.toMatch(/(?<!motion-safe:)\banimate-spin/);
    },
  );
});

describe("F-19: a single tone in the waiting blocks", () => {
  it.each([
    "app/auth/page.tsx",
    "components/learn/learn-dashboard.tsx",
    "components/teacher/teacher-members-area-hub.tsx",
    "components/teacher/teacher-inbox-questions.tsx",
    "components/teacher/teacher-messages-inbox.tsx",
    // Leftovers: the catalog search, the learner's messages and the
    // teacher directory (which pulsed a white card with a shadow).
    "app/courses/page.tsx",
    "app/learn/messages/page.tsx",
    "components/learn/student-messages-inbox.tsx",
    "components/instructors/instructors-directory.tsx",
    // The Earnings statement, the account block and the renewals used to wait with a sentence.
    "components/teacher/teacher-wallet-panel.tsx",
    "components/teacher/creator-subscription-center.tsx",
  ])("%s paints the bone in surface-strong", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/animate-pulse[^"]*bg-\[var\(--color-surface-soft\)\]/);
    expect(source).not.toMatch(/animate-pulse[^"]*bg-white/);
    expect(source).toMatch(/animate-pulse[^"]*bg-\[var\(--color-surface-strong\)\]/);
  });

  // The product list rows pulsed in surface-soft (F-19). There the
  // blocks use the `block` constant, so the proof is the constant.
  it("components/teacher/builder-skeleton.tsx paints the bone in surface-strong", () => {
    const source = read("components/teacher/builder-skeleton.tsx");
    expect(source).not.toMatch(/animate-pulse[^"]*bg-\[var\(--color-surface-soft\)\]/);
    expect(source).toContain('const block = "bg-[var(--color-surface-strong)]";');
  });
});

describe("F-03 / T-07: Storefront, Media and Events wait with the shape of the screen", () => {
  it.each([
    ["components/teacher/storefront-settings-panel.tsx", 'data-skeleton="storefront"'],
    ["components/teacher/teacher-media-library.tsx", "<CardStackSkeleton"],
    ["components/teacher/teacher-event-studio.tsx", "<CardStackSkeleton"],
  ])("%s does not wait with a sentence in a card", (file, skeleton) => {
    expect(read(file)).toContain(skeleton);
  });
});
