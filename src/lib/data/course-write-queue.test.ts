import { expect, it, vi } from "vitest";
import { invalidateCourseWrites, runCourseWrite } from "./course-write-queue";

it("does not run a queued save under a different account", async () => {
  let finish!: () => void;
  const first = runCourseWrite("c", () => new Promise<void>((resolve) => { finish = resolve; }));
  await Promise.resolve();
  await Promise.resolve();
  const write = vi.fn(async () => {});
  const queued = runCourseWrite("c", write);
  invalidateCourseWrites();
  finish();
  await first;
  await expect(queued).rejects.toThrow("account changed");
  expect(write).not.toHaveBeenCalled();
  await runCourseWrite("c", write);
  expect(write).toHaveBeenCalledOnce();
});

it("allows independent courses to save without waiting for each other", async () => {
  let finish!: () => void;
  const first = runCourseWrite("a", () => new Promise<void>((resolve) => { finish = resolve; }));
  await expect(runCourseWrite("b", async () => "saved")).resolves.toBe("saved");
  finish();
  await first;
});
