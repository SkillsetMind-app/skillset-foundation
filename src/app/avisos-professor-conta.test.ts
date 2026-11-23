import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Leitura do fonte, como em revisao-pr494.test.ts: o jsdom não pinta nada, então
// o que dá para provar é que a caixa feita à mão não voltou. A caixa de 6% de
// vermelho literal sumia no tema escuro, muitas não eram anunciadas e nenhuma
// tinha ícone; o InlineAlert tem as três coisas.
const read = (path: string) => readFileSync(join(process.cwd(), "src/components", path), "utf8");

describe("F-07: professor, conta e formulários de entrada usam o aviso da casa", () => {
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
  ])("%s não desenha a caixa vermelha à mão", (file) => {
    const source = read(file);
    expect(source).not.toContain("bg-[rgba(178,34,52,0.06)]");
    expect(source).toContain('<InlineAlert tone="error"');
  });

  // O construtor e o painel do curso mostram a mesma prontidão com a mesma barra.
  it.each(["teacher/course-builder-studio.tsx", "teacher/course-manage-hub.tsx", "teacher/teacher-studio-dashboard.tsx"])(
    "%s usa a barra compartilhada, sem trilho navy literal",
    (file) => {
      const source = read(file);
      expect(source).toContain("<ProgressBar");
      expect(source).not.toContain("bg-[rgba(26,54,93,0.12)]");
    },
  );
});
