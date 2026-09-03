import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WatermarkedVideoPlayer } from "@/components/learn/watermarked-video-player";
import {
  lessonPositionKey,
  readLessonPosition,
  saveLessonPosition,
} from "@/lib/learn/lesson-position";

/**
 * O "retomar" era por AULA, nunca por posição: parar aos 22 minutos e voltar
 * no segundo zero. Aqui se prova o ciclo inteiro no player nativo — guardar
 * enquanto toca, restaurar ao reabrir, e apagar quando não vale mais.
 */

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "student-1", email: "student@example.com", roles: ["student"] },
  }),
}));

const KEY = lessonPositionKey("student-1", "l1") as string;

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
});

afterEach(cleanup);

describe("a aula volta onde parou", () => {
  it("tocando, a posição é gravada — e não a cada quadro", () => {
    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resumeKey={KEY} src="blob:aula" />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    fakeMedia(video, 42, 600);
    fireEvent.timeUpdate(video);
    expect(readLessonPosition(KEY)).toBe(42);

    // 3 s depois ainda é a mesma gravação: o timeupdate dispara ~4x por
    // segundo e escrever em todos seria desperdício.
    (video as { currentTime: number }).currentTime = 45;
    fireEvent.timeUpdate(video);
    expect(readLessonPosition(KEY)).toBe(42);

    (video as { currentTime: number }).currentTime = 61;
    fireEvent.timeUpdate(video);
    expect(readLessonPosition(KEY)).toBe(61);
  });

  it("reabrindo a aula, o vídeo pula para o segundo guardado", () => {
    saveLessonPosition(KEY, 137, 600);

    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resumeKey={KEY} src="blob:aula" />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    fakeMedia(video, 0, 600);
    fireEvent.loadedMetadata(video);

    expect(video.currentTime).toBe(137);
  });

  it("posição maior que a duração é ignorada (o professor regravou a aula)", () => {
    saveLessonPosition(KEY, 500, 600);

    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resumeKey={KEY} src="blob:aula" />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    // A nova take tem 90 s: pular para 500 jogaria o aluno para fora da linha.
    fakeMedia(video, 0, 90);
    fireEvent.loadedMetadata(video);

    expect(video.currentTime).toBe(0);
  });

  it("terminando a aula a posição some — voltar nela não cai nos créditos", () => {
    const onEnded = vi.fn();
    saveLessonPosition(KEY, 300, 600);

    render(
      <WatermarkedVideoPlayer
        fileName="aula.mp4"
        onEnded={onEnded}
        resumeKey={KEY}
        src="blob:aula"
      />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    fakeMedia(video, 600, 600);
    fireEvent.ended(video);

    expect(readLessonPosition(KEY)).toBe(0);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("sem chave (preview do professor, sessão anônima) nada é gravado", () => {
    expect(lessonPositionKey(null, "l1")).toBeNull();

    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resumeKey={null} src="blob:aula" />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    fakeMedia(video, 120, 600);
    fireEvent.timeUpdate(video);

    expect(window.localStorage.length).toBe(0);
  });
});

describe("o que não vale a pena guardar", () => {
  it("os primeiros segundos e os últimos são descartados", () => {
    saveLessonPosition(KEY, 3, 600);
    expect(readLessonPosition(KEY)).toBe(0);

    // Perto do fim, apaga o que houvesse — não só deixa de gravar.
    saveLessonPosition(KEY, 200, 600);
    expect(readLessonPosition(KEY)).toBe(200);
    saveLessonPosition(KEY, 595, 600);
    expect(readLessonPosition(KEY)).toBe(0);
  });

  it("armazenamento bloqueado não derruba a aula", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    expect(() => saveLessonPosition(KEY, 42, 600)).not.toThrow();
    expect(readLessonPosition(KEY)).toBe(0);

    setItem.mockRestore();
  });
});
