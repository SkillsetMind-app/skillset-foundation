import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Both extensions on purpose: most domain modules are plain .ts, and a
    // test file named *.test.ts used to be collected by nothing — it would
    // "pass" by never running. The old second entry pointed at functions/src,
    // a directory this repo does not have.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
