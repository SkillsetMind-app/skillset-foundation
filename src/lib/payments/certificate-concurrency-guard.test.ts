import { it } from "vitest";

it("restricts the certificate concurrency proof to disposable CI and mutates only its enrollment lock", async () => {
  const { selfTest } = await import("../../../scripts/check-certificate-concurrency.mjs");
  selfTest();
});
