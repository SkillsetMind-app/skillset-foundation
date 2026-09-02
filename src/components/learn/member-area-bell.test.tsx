import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberAreaShell } from "@/components/learn/member-area-shell";

// A sala de aula usa esta casca (sem barra lateral) e ela nao tinha sino: o
// painel de mensagens dizia "a resposta cai no sino" numa tela onde o sino nao
// existia. Mesmo componente da plataforma, mesma lista de avisos.

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "student-1",
      email: "student@example.com",
      displayName: "Student",
      emailVerified: true,
      photoURL: null,
      roles: ["student"],
    },
  }),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/data/notifications", () => ({
  subscribeToNotifications: vi.fn((_uid, onNext) => {
    onNext([]);
    return vi.fn();
  }),
  markNotificationAsRead: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
}));

// Com o t() identidade, o nome acessivel do sino e a propria chave.
const bellName = /platform\.notifications\.open/;

describe("o sino na barra da area de membros", () => {
  it("aparece na barra da plataforma — sozinho: a saida da sala mora na capa/cabecalho", () => {
    render(
      <MemberAreaShell>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(screen.getByRole("button", { name: bellName })).toBeInTheDocument();
    // "Exit to dashboard" era a terceira saida para /learn (reanalise item 8).
    expect(screen.queryByText("Exit to dashboard")).toBeNull();
  });

  it("fica fora da area com marca do professor: cada aviso e uma porta de volta para a plataforma", () => {
    render(
      <MemberAreaShell brand={{ name: "Atelier Curie" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(
      screen.queryByRole("button", { name: bellName }),
    ).not.toBeInTheDocument();
  });
});
