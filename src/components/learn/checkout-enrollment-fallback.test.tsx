import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * A tela pós-pagamento promete, com todas as letras: "Keep this page open: it
 * opens automatically the moment your enrollment is confirmed."
 *
 * A ÚNICA coisa capaz de cumprir essa promessa era o `postgres_changes` — um
 * WebSocket. Aba de celular em segundo plano, proxy corporativo ou wi-fi
 * instável derrubam esse socket em silêncio: o canal continua "inscrito" e
 * nunca dispara. A promessa virava mentira e o comprador — que já pagou —
 * ficava ali para sempre, sem saber que bastava recarregar.
 *
 * Estes testes seguram a rede de segurança: enquanto a matrícula não chega, a
 * inscrição é reemitida periodicamente, ANTES e DEPOIS da carência de 90s.
 */

const mocks = vi.hoisted(() => ({
  subscribeToEnrollment: vi.fn(),
  searchParams: new URLSearchParams("checkout=success"),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "buyer-1", email: "buyer@example.com", roles: ["student"] },
  }),
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: mocks.subscribeToEnrollment,
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  image: null,
  modules: [],
  membersTheme: "light",
} as unknown as Course;

describe("rede de segurança entre pagar e a matrícula aparecer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.subscribeToEnrollment.mockReset();
    // Socket "vivo" que entrega o estado atual (nenhuma matrícula ainda) e
    // depois nunca mais dispara — exatamente o modo de falha real: o canal
    // segue inscrito e o webhook nunca chega até ele.
    mocks.subscribeToEnrollment.mockImplementation((_uid, _slug, onNext) => {
      onNext(null);
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reemite a inscrição enquanto a matrícula não chega", () => {
    render(<EnrolledCourseWorkspace course={course} />);

    const initialCalls = mocks.subscribeToEnrollment.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(11_000);
    });

    // Dois ciclos de 5s dentro da carência.
    expect(mocks.subscribeToEnrollment.mock.calls.length).toBeGreaterThan(
      initialCalls,
    );
  });

  it("NÃO desiste depois dos 90s de carência", () => {
    render(<EnrolledCourseWorkspace course={course} />);

    act(() => {
      vi.advanceTimersByTime(95_000);
    });

    // A carência expirou: a cópia muda, mas o fallback tem de continuar. Passar
    // dos 90s é justamente o sinal de que o WebSocket não entregou — desligar o
    // poll aqui deixaria o socket morto como único caminho restante.
    expect(
      screen.getByText(/taking longer than usual/i),
    ).toBeInTheDocument();

    const callsAtGrace = mocks.subscribeToEnrollment.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    expect(mocks.subscribeToEnrollment.mock.calls.length).toBeGreaterThan(
      callsAtGrace,
    );
  });
});
