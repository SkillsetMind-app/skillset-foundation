import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("backs up nested Storage objects, spaces and every page", () => {
  expect(() => execFileSync(process.platform === "win32" ? "py" : "python3", [
    "scripts/test_backup_storage.py",
  ], { timeout: 60_000, stdio: "pipe" })).not.toThrow();
}, 60_000);
