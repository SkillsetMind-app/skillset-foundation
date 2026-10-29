import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, it } from "vitest";

it("refuses to launch a browser or server outside GitHub CI", () => {
  const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-certificate-visual.mjs")], {
    env: { PATH: process.env.PATH, GITHUB_ACTIONS: "false" },
    encoding: "utf8",
    timeout: 10000,
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("GitHub Linux runner only");
});
