import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Source read, as in revisao-pr494.test.ts: jsdom does not paint anything, so
// what can be proven is that the hand-made box did not come back. The box with literal 6% red
// disappeared in the dark theme, many were not announced and none
// had an icon; the InlineAlert has all three.
const read = (path: string) => readFileSync(join(process.cwd(), "src/components", path), "utf8");

describe("F-07: teacher, account and entry forms use the house notice", () => {
  it.each([
    "teacher/course-asset-uploader.tsx",
    "teacher/create-course-start.tsx",
    "teacher/save-status-line.tsx",
    "teacher/teacher-community-inbox.tsx",
    "teacher/teacher-course-studio.tsx",
    "teacher/teacher-event-studio.tsx",
    "account/billing-tabs.tsx",
    "account/plans-panel.tsx",
    "account/profile-settings-panel.tsx",
    "account/totp-mfa-section.tsx",
    "shared/protected-asset-preview.tsx",
    "auth/login-form.tsx",
    "auth/signup-form.tsx",
    "auth/update-password-form.tsx",
  ])("%s does not draw the red box by hand", (file) => {
    const source = read(file);
    expect(source).not.toContain("bg-[rgba(178,34,52,0.06)]");
    expect(source).toContain('<InlineAlert tone="error"');
  });

  // The builder and the course panel show the same readiness with the same bar.
  it.each(["teacher/course-builder-studio.tsx", "teacher/course-manage-hub.tsx", "teacher/teacher-studio-dashboard.tsx"])(
    "%s uses the shared bar, with no literal navy track",
    (file) => {
      const source = read(file);
      expect(source).toContain("<ProgressBar");
      expect(source).not.toContain("bg-[rgba(26,54,93,0.12)]");
    },
  );
});
