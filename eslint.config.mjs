import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "docs/design-reference/**",
    "docs/design-system/**",
    // Stray git worktrees (e.g. agent isolation checkouts) duplicate the whole
    // repo under here; without this, `eslint .` lints those copies too.
    ".claude/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
