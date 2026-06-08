import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globals: true,
    include: ["tests/firestore-rules.ts", "tests/storage-rules.ts"],
    // Booting the Firestore/Storage emulators in beforeAll can exceed the
    // default 10s hookTimeout on a cold machine (the init flake seen on
    // 2026-06-07), which skips the whole suite. Give emulator init and each
    // rules round-trip generous headroom so a slow cold start is not a
    // false failure.
    hookTimeout: 60000,
    testTimeout: 20000,
  },
});
