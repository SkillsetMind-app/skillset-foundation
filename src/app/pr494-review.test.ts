import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Guards for the PR #494 review. They read the source (like
// button-sizes-cascade does with the CSS): jsdom does not measure layout, so what
// can be proven without a browser is that the right class is in the right place.

const read = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");

// Finds the element that contains `needle` and returns the text of its opening tag.
function tagAround(source: string, needle: string): string {
  const at = source.indexOf(needle);
  expect(at, `snippet not found: ${needle}`).toBeGreaterThan(-1);
  const start = source.lastIndexOf("<", at);
  return source.slice(start, source.indexOf(">", at) + 1);
}

describe("C1: the status chip wraps instead of leaving the card", () => {
  it("the type + status row of the product card has flex-wrap", () => {
    const tag = tagAround(
      read("components/teacher/teacher-studio-dashboard.tsx"),
      "flex flex-wrap items-start justify-between gap-2",
    );
    expect(tag).toContain("flex-wrap");
  });
});

describe("C2: buttons without .button-* keep the 44px floor (min-h-11)", () => {
  const sites: [string, string][] = [
    // The "Send me a new link" button of the expired link became .button-solid (44px comes from the
    // class), so it left this list of buttons without .button-*.
    // "Wrong email? Change it" became a text link, but it still has a 44px target.
    ["components/auth/confirm-email-gate.tsx", "min-h-11 rounded-md px-4 text-sm font-semibold text-[var(--color-primary)]"],
    ["components/auth/signup-form.tsx", '"min-h-11 rounded-md border-[1.5px]'],
    ["components/account/profile-settings-panel.tsx", "min-h-11 shrink-0 rounded-md border"],
    // The "Save page" became the house Button (min-h-11 of size md); the hand-made
    // button left there is the page template one, also 44px.
    ["components/teacher/course-landing-editor.tsx", "inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-2"],
    ["components/teacher/course-landing-editor.tsx", "mt-3 min-h-11 justify-self-start"],
    // The image field buttons live in the single shell (B-05).
    ["components/teacher/image-upload-field.tsx", "inline-flex min-h-11 w-fit items-center gap-2 rounded-md border"],
  ];

  it.each(sites)("%s has min-h-11 in %s", (file, snippet) => {
    expect(read(file)).toContain(snippet);
  });

  it("both image field buttons have min-h-11", () => {
    const hits = read("components/teacher/image-upload-field.tsx").match(/min-h-11 w-fit/g);
    expect(hits).toHaveLength(2);
  });

  it("the global font: inherit rule did not come back", () => {
    expect(read("app/globals.css")).not.toMatch(/^button,\s*input,\s*textarea,\s*select\s*\{/m);
  });
});

describe("C3: brass outside error, warning and deletion", () => {
  const dangerText = "text-[var(--color-danger-fg)]";
  // Third item: what the tag must have, when it is not the direct class.
  const errorSites: [string, string, string?][] = [
    // Became an error InlineAlert (F-07), which paints the text in danger-fg.
    ["components/teacher/activation-checkout-panel.tsx", 'className="m-6"', 'tone="error"'],
    // The embedded checkout error became the error InlineAlert (F-07), inside
    // the same p-6 frame (the line below checks the frame).
    ["components/account/embedded-checkout-panel.tsx", '<InlineAlert tone="error" title={t("activationCheckout.errorTitle")}', 'tone="error"'],
    ["components/account/embedded-checkout-panel.tsx", '<div className="p-6 text-sm">', 'className="p-6 text-sm"'],
    // Became LoadErrorAlert (F-11: with "Try again"), which always draws the
    // error InlineAlert, checked on the next line.
    ["components/learn/community-leaderboard.tsx", "<LoadErrorAlert", "<LoadErrorAlert"],
    ["components/ui/load-error-alert.tsx", '<InlineAlert tone="error"', 'tone="error"'],
    ["components/certificates/certificate-verification-panel.tsx", '<h2 className="text-lg font-semibold'],
  ];

  it.each(errorSites)("%s: error in danger-fg", (file, needle, expected = dangerText) => {
    expect(tagAround(read(file), needle)).toContain(expected);
  });

  it("mismatched passwords in danger-fg", () => {
    const src = read("components/auth/update-password-form.tsx");
    const i = src.indexOf('t("auth.signup.passwordsDontMatch")');
    expect(src.slice(src.lastIndexOf("<span", i), i)).toContain(dangerText);
  });

  // I-04: deleting and withdrawing open the same danger dialog (ConfirmActionDialog,
  // solid red); the two buttons on the card are variant="danger".
  it("confirming course deletion uses the danger dialog, not button-accent", () => {
    const src = read("components/admin/managed-course-panel.tsx");
    expect(src).not.toContain("button-accent");
    expect(src.match(/variant="danger"/g)?.length).toBe(2);
    expect(src.match(/<ConfirmActionDialog/g)?.length).toBe(2);
  });

  it("remove credential: hover in danger-fg, no brass", () => {
    const tag = tagAround(read("components/account/profile-settings-panel.tsx"), "removeCredential(index)");
    const cls = read("components/account/profile-settings-panel.tsx").match(
      /className="min-h-11 shrink-0[^"]*"/,
    )?.[0];
    expect(tag).toBeTruthy();
    expect(cls).toContain("hover:text-[var(--color-danger-fg)]");
    expect(cls).not.toContain("accent");
  });

  it("error page eyebrow in navy and live_event chip without brass", () => {
    expect(tagAround(read("app/error.tsx"), 'appErrors.eyebrow')).not.toContain("accent");
    // The 404 uses the same eyebrow (F-17): it was brass, the error page was navy.
    const eyebrowClass = (file: string, key: string) => tagAround(read(file), key).match(/className="([^"]*)"/)?.[1];
    expect(eyebrowClass("app/not-found.tsx", "publicPages.notFound.eyebrow")).toBe(
      eyebrowClass("app/error.tsx", "appErrors.eyebrow"),
    );
    expect(eyebrowClass("app/not-found.tsx", "publicPages.notFound.eyebrow")).toContain("--color-primary");
    const row = read("components/account/notification-row.tsx");
    expect(row).toMatch(/live_event: "[^"]*text-\[var\(--color-danger-fg\)\]"/);
  });
});

describe("Plausible 5: text button with at least 24px of area", () => {
  it.each([
    // The "Email me a reset link" in Security went to 44px and 14px.
    ["components/account/security-settings-panel.tsx", "min-h-11 text-sm font-bold"],
    // Copy, 2FA Cancel and "Request a refund" became system buttons
    // (.button-outline: 44px), above the 24px minimum this test guards.
    ["components/account/totp-mfa-section.tsx", "button-outline shrink-0 px-3 py-2 text-xs"],
    // The 2FA Cancel moved to the house footer, at the same size as the others (14px).
    ["components/account/totp-mfa-section.tsx", "button-outline min-h-11 px-4 py-2.5 text-sm"],
    ["components/account/billing-tabs.tsx", "button-outline px-3 py-2 text-xs"],
    // The Pin left the card header (PR #505) and lives in the actions, at 44px.
    ["components/learn/community-item-actions.tsx", "min-h-11 rounded-md px-3 text-xs font-semibold"],
    ["components/auth/signup-form.tsx", "inline-flex min-h-6 items-center"],
  ])("%s has %s", (file, snippet) => {
    expect(read(file)).toContain(snippet);
  });

  // Went up from 24px to the 44px floor: they are delete buttons for touch.
  it("both Remove buttons of the landing editor have min-h-11", () => {
    const hits = read("components/teacher/course-landing-editor.tsx").match(/"min-h-11 justify-self-start/g);
    expect(hits).toHaveLength(2);
  });
});

describe("Plausible 6: JS scrolling respects reduced motion", () => {
  it.each([
    "components/auth/reset-password-form.tsx",
    "components/learn/course-unlock-modal.tsx",
    "components/learn/enrolled-course-workspace.tsx",
  ])("%s usa scrollBehavior()", (file) => {
    const src = read(file);
    expect(src).toContain("scrollBehavior()");
    expect(src).not.toMatch(/behavior: "smooth"/);
  });

  // Security no longer scrolls: each answer appears right below the button that
  // asked for it, so there is no scrolling to respect (nor any scrolling back without easing).
  it("components/account/security-settings-panel.tsx does not scroll the page", () => {
    expect(read("components/account/security-settings-panel.tsx")).not.toContain("scrollIntoView");
  });
});
