import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("preserves restored blobs and rejects incomplete archives before replacing DR storage", () => {
  expect(() => execFileSync(process.platform === "win32" ? "py" : "python3", [
    "scripts/test_restore_backup.py",
  ], { timeout: 60_000, stdio: "pipe" })).not.toThrow();
}, 60_000);
