import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WatermarkedVideoPlayer } from "@/components/learn/watermarked-video-player";
import {
  lessonPositionRef,
  readLessonPosition,
  saveLessonPosition,
} from "@/lib/learn/lesson-position";

/**
 * O "retomar" era por AULA, nunca por posição: parar aos 22 minutos e voltar
 * no segundo zero. Aqui se prova o ciclo inteiro no player nativo — guardar
 * enquanto toca, restaurar ao reabrir, e apagar quando não vale mais.
 *
 * A partir da migração 20260903120000 a fonte é o BANCO, para a posição
 * atravessar aparelhos; o navegador virou reserva. As duas metades estão
 * provadas aqui: de onde a posição vem quando há matrícula, e o que sobra
 * quando não há.
 */

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "student-1", email: "student@example.com", roles: ["student"] },
  }),
}));

const buscarNoBanco = vi.fn<(enrollmentId: string, lessonId: string) => Promise<number>>();
const gravarNoBanco =
  vi.fn<
    (
      enrollmentId: string,
      lessonId: string,
      positionSeconds: number | null,
      durationSeconds?: number | null,
    ) => Promise<void>
  >();

vi.mock("@/lib/data/lesson-playback", () => ({
  fetchLessonPosition: (enrollmentId: string, lessonId: string) =>
    buscarNoBanco(enrollmentId, lessonId),
  recordLessonPlayback: (
    enrollmentId: string,
    lessonId: string,
    positionSeconds: number | null,
    durationSeconds?: number | null,
  ) => gravarNoBanco(enrollmentId, lessonId, positionSeconds, durationSeconds),
}));

/** Aluno matriculado: a posição vai e volta do banco. */
const REF = lessonPositionRef("student-1", "enr-1", "l1")!;
/** Sem matrícula (preview do professor, sessão anônima): só o navegador. */
const REF_LOCAL = lessonPositionRef("student-1", null, "l1")!;

/** O jsdom não implementa mídia: currentTime e duration são só propriedades. */
function fakeMedia(video: HTMLVideoElement, currentTime: number, duration: number) {
  Object.defineProperty(video, "duration", { value: duration, configurable: true });
  Object.defineProperty(video, "currentTime", {
    value: currentTime,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  buscarNoBanco.mockReset();
  buscarNoBanco.mockResolvedValue(0);
  gravarNoBanco.mockReset();
  gravarNoBanco.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("a aula volta onde parou", () => {
  it("tocando, a posição é gravada — e não a cada quadro", () => {
    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resume={REF} src="blob:aula" />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    fakeMedia(video, 42, 600);
    fireEvent.timeUpdate(video);
    expect(gravarNoBanco).toHaveBeenCalledWith("enr-1", "l1", 42, 600);
    expect(window.localStorage.getItem(REF.storageKey)).toBe("42");

    // 3 s depois ainda é a mesma gravação: o timeupdate dispara ~4x por
    // segundo e escrever em todos seria desperdício — de banco, agora.
    gravarNoBanco.mockClear();
    (video as { currentTime: number }).currentTime = 45;
    fireEvent.timeUpdate(video);
    expect(gravarNoBanco).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REF.storageKey)).toBe("42");

    (video as { currentTime: number }).currentTime = 61;
    fireEvent.timeUpdate(video);
    expect(gravarNoBanco).toHaveBeenCalledWith("enr-1", "l1", 61, 600);
  });

  it("reabrindo a aula, o vídeo pula para o segundo que o BANCO guardou", async () => {
    // O celular parou aos 137 s; este é o computador, com localStorage vazio.
    buscarNoBanco.mockResolvedValue(137);

    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resume={REF} src="blob:aula" />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    fakeMedia(video, 0, 600);
    fireEvent.loadedMetadata(video);

    await waitFor(() => expect(video.currentTime).toBe(137));
    expect(buscarNoBanco).toHaveBeenCalledWith("enr-1", "l1");
  });

  it("banco fora do ar: a posição deste navegador ainda vale", async () => {
    buscarNoBanco.mockRejectedValue(new Error("sem rede"));
    window.localStorage.setItem(REF.storageKey, "90");

    await expect(readLessonPosition(REF)).resolves.toBe(90);
  });

  it("sem matrícula não se consulta o banco — só o navegador", async () => {
    window.localStorage.setItem(REF_LOCAL.storageKey, "77");

    await expect(readLessonPosition(REF_LOCAL)).resolves.toBe(77);
    expect(buscarNoBanco).not.toHaveBeenCalled();

    saveLessonPosition(REF_LOCAL, 120, 600);
    expect(gravarNoBanco).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REF_LOCAL.storageKey)).toBe("120");
  });

  it("posição maior que a duração é ignorada (o professor regravou a aula)", async () => {
    buscarNoBanco.mockResolvedValue(500);

    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resume={REF} src="blob:aula" />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    // A nova take tem 90 s: pular para 500 jogaria o aluno para fora da linha.
    fakeMedia(video, 0, 90);
    fireEvent.loadedMetadata(video);

    await waitFor(() => expect(buscarNoBanco).toHaveBeenCalled());
    expect(video.currentTime).toBe(0);
  });

  it("terminando a aula a posição some — voltar nela não cai nos créditos", () => {
    const onEnded = vi.fn();
    window.localStorage.setItem(REF.storageKey, "300");

    render(
      <WatermarkedVideoPlayer
        fileName="aula.mp4"
        onEnded={onEnded}
        resume={REF}
        src="blob:aula"
      />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    fakeMedia(video, 600, 600);
    fireEvent.ended(video);

    expect(window.localStorage.getItem(REF.storageKey)).toBeNull();
    // Zero EXPLÍCITO: no banco isso zera a posição (nulo seria "só passei aqui").
    expect(gravarNoBanco).toHaveBeenCalledWith("enr-1", "l1", 0, null);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("sem referência (preview do professor) nada é gravado", () => {
    expect(lessonPositionRef(null, "enr-1", "l1")).toBeNull();

    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resume={null} src="blob:aula" />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    fakeMedia(video, 120, 600);
    fireEvent.timeUpdate(video);

    expect(window.localStorage.length).toBe(0);
    expect(gravarNoBanco).not.toHaveBeenCalled();
  });
});

describe("o funil: abrir a aula já deixa rastro", () => {
  it("abrir manda posição NULA — registra a visita sem apagar a retomada", () => {
    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resume={REF} src="blob:aula" />,
    );

    expect(gravarNoBanco).toHaveBeenCalledWith("enr-1", "l1", null, null);
  });
});

describe("o que não vale a pena guardar", () => {
  it("os primeiros segundos e os últimos são descartados", async () => {
    saveLessonPosition(REF_LOCAL, 3, 600);
    await expect(readLessonPosition(REF_LOCAL)).resolves.toBe(0);

    // Perto do fim, apaga o que houvesse — não só deixa de gravar.
    saveLessonPosition(REF_LOCAL, 200, 600);
    await expect(readLessonPosition(REF_LOCAL)).resolves.toBe(200);
    saveLessonPosition(REF_LOCAL, 595, 600);
    await expect(readLessonPosition(REF_LOCAL)).resolves.toBe(0);
  });

  it("armazenamento bloqueado não derruba a aula", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    expect(() => saveLessonPosition(REF_LOCAL, 42, 600)).not.toThrow();
    await expect(readLessonPosition(REF_LOCAL)).resolves.toBe(0);

    setItem.mockRestore();
  });

  it("banco recusando a escrita não derruba a aula", () => {
    gravarNoBanco.mockRejectedValue(new Error("RATE_LIMIT"));

    expect(() => saveLessonPosition(REF, 42, 600)).not.toThrow();
    expect(window.localStorage.getItem(REF.storageKey)).toBe("42");
  });
});
