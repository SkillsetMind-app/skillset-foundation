import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WatermarkedVideoPlayer } from "@/components/learn/watermarked-video-player";
import {
  lessonPositionRef,
  readLessonPosition,
  saveLessonPosition,
} from "@/lib/learn/lesson-position";

/**
 * "Resume" worked per LESSON, never per position: stop at minute 22 and come back
 * at second zero. This proves the whole cycle in the native player — save
 * while playing, restore on reopen, and erase when it no longer applies.
 *
 * Since migration 20260903120000 the source is the DATABASE, so the position
 * crosses devices; the browser became the fallback. Both halves are
 * proven here: where the position comes from when there is an enrollment, and what is left
 * when there is not.
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

/** Enrolled learner: the position goes to and comes back from the database. */
const REF = lessonPositionRef("student-1", "enr-1", "l1")!;
/** No enrollment (teacher preview, anonymous session): the browser only. */
const REF_LOCAL = lessonPositionRef("student-1", null, "l1")!;

/** jsdom does not implement media: currentTime and duration are just properties. */
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

describe("the lesson resumes where it stopped", () => {
  it("while playing, the position is saved — and not on every frame", () => {
    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resume={REF} src="blob:aula" />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    fakeMedia(video, 42, 600);
    fireEvent.timeUpdate(video);
    expect(gravarNoBanco).toHaveBeenCalledWith("enr-1", "l1", 42, 600);
    expect(window.localStorage.getItem(REF.storageKey)).toBe("42");

    // 3 s later it is still the same save: timeupdate fires ~4x per
    // second and writing on every one would be a waste — of the database, now.
    gravarNoBanco.mockClear();
    (video as { currentTime: number }).currentTime = 45;
    fireEvent.timeUpdate(video);
    expect(gravarNoBanco).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REF.storageKey)).toBe("42");

    (video as { currentTime: number }).currentTime = 61;
    fireEvent.timeUpdate(video);
    expect(gravarNoBanco).toHaveBeenCalledWith("enr-1", "l1", 61, 600);
  });

  it("when the lesson is reopened, the video jumps to the second the DATABASE saved", async () => {
    // The phone stopped at 137 s; this is the computer, with empty localStorage.
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

  it("database down: this browser's position still counts", async () => {
    buscarNoBanco.mockRejectedValue(new Error("no network"));
    window.localStorage.setItem(REF.storageKey, "90");

    await expect(readLessonPosition(REF)).resolves.toBe(90);
  });

  it("without an enrollment the database is not queried — only the browser", async () => {
    window.localStorage.setItem(REF_LOCAL.storageKey, "77");

    await expect(readLessonPosition(REF_LOCAL)).resolves.toBe(77);
    expect(buscarNoBanco).not.toHaveBeenCalled();

    saveLessonPosition(REF_LOCAL, 120, 600);
    expect(gravarNoBanco).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REF_LOCAL.storageKey)).toBe("120");
  });

  it("a position greater than the duration is ignored (the teacher re-recorded the lesson)", async () => {
    buscarNoBanco.mockResolvedValue(500);

    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resume={REF} src="blob:aula" />,
    );

    const video = screen.getByLabelText("aula.mp4") as HTMLVideoElement;

    // The new take is 90 s long: jumping to 500 would throw the learner off the timeline.
    fakeMedia(video, 0, 90);
    fireEvent.loadedMetadata(video);

    await waitFor(() => expect(buscarNoBanco).toHaveBeenCalled());
    expect(video.currentTime).toBe(0);
  });

  it("when the lesson ends the position is erased — going back to it does not land on the credits", () => {
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
    // EXPLICIT zero: in the database this resets the position (null would mean "I just passed by").
    expect(gravarNoBanco).toHaveBeenCalledWith("enr-1", "l1", 0, null);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("without a reference (teacher preview) nothing is saved", () => {
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

describe("the funnel: opening the lesson already leaves a trace", () => {
  it("opening sends a NULL position — records the visit without erasing the resume point", () => {
    render(
      <WatermarkedVideoPlayer fileName="aula.mp4" resume={REF} src="blob:aula" />,
    );

    expect(gravarNoBanco).toHaveBeenCalledWith("enr-1", "l1", null, null);
  });
});

describe("what is not worth saving", () => {
  it("the first seconds and the last ones are discarded", async () => {
    saveLessonPosition(REF_LOCAL, 3, 600);
    await expect(readLessonPosition(REF_LOCAL)).resolves.toBe(0);

    // Near the end, it erases whatever was there — it does not just stop saving.
    saveLessonPosition(REF_LOCAL, 200, 600);
    await expect(readLessonPosition(REF_LOCAL)).resolves.toBe(200);
    saveLessonPosition(REF_LOCAL, 595, 600);
    await expect(readLessonPosition(REF_LOCAL)).resolves.toBe(0);
  });

  it("blocked storage does not break the lesson", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    expect(() => saveLessonPosition(REF_LOCAL, 42, 600)).not.toThrow();
    await expect(readLessonPosition(REF_LOCAL)).resolves.toBe(0);

    setItem.mockRestore();
  });

  it("a database refusing the write does not break the lesson", () => {
    gravarNoBanco.mockRejectedValue(new Error("RATE_LIMIT"));

    expect(() => saveLessonPosition(REF, 42, 600)).not.toThrow();
    expect(window.localStorage.getItem(REF.storageKey)).toBe("42");
  });
});
