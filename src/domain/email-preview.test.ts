import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { test } from "vitest";

test("email preview uses deployed artwork and resolves invitation placeholders", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillset-email-preview-"));
  try {
    const output = join(dir, "preview.html");
    execFileSync(process.execPath, ["scripts/build-email-preview.mjs", output]);
    const page = readFileSync(output, "utf8");
    assert.ok(page.includes('src="https://www.skillsetmind.com/brand/logo-lockup-on-navy.png"'));
    assert.ok(!page.includes("data:image/png;base64,"), "embedded logo masks network failures");
    assert.ok(!page.includes("{{ .RedirectTo | urlquery }}"), "unresolved invitation redirect");
    assert.ok(page.includes("%2Finvitations%2F81000000"));
    assert.ok(page.includes('<meta charset="utf-8">'));
    for (const file of ["confirmation.html", "magic_link.html"]) {
      const template = readFileSync(join("supabase/templates", file), "utf8");
      assert.ok(template.includes("Your access changes only after you accept the invitation."));
      assert.ok(template.includes("{{ .RedirectTo | urlquery }}"));
      assert.ok(template.includes('alt="SkillsetMind"'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
