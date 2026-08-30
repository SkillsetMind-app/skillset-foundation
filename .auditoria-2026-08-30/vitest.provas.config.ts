import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Suite de PROVAS da auditoria de 2026-08-30 — deliberadamente VERMELHA.
 *
 * Cada teste aqui reproduz um bug confirmado. Enquanto o bug existir, o teste
 * falha; quando o bug for corrigido, ele passa. É o oposto de uma suite normal,
 * e por isso vive FORA de `src/`: o `vitest.config.ts` do repo coleta
 * `src/**\/*.test.{ts,tsx}`, então um teste vermelho lá dentro deixaria o
 * `npm test` e o CI vermelhos em todo PR futuro — o relatório viraria ruído
 * permanente em vez de sinal.
 *
 * Rodar:
 *   npx vitest run --config .auditoria-2026-08-30/vitest.provas.config.ts
 *
 * Ao corrigir um bug, mova o teste correspondente para junto do código que ele
 * exercita, dentro de `src/`, para virar teste de regressão de verdade.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    root: process.cwd(),
    setupFiles: ["./vitest.setup.ts"],
    include: [".auditoria-2026-08-30/provas/**/*.test.{ts,tsx}"],
  },
});
