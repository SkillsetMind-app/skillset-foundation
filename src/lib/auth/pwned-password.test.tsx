import { describe, expect, it } from "vitest";

import { isSuffixBreached } from "@/lib/auth/pwned-password";

// 35-char SHA-1 suffix of "password" (full hash 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8,
// minus the 5-char "5BAA6" prefix the client keeps private).
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

describe("isSuffixBreached", () => {
  it("matches a real breach entry (count > 0)", () => {
    const body = `${SUFFIX}:99999\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3`;
    expect(isSuffixBreached(body, SUFFIX)).toBe(true);
  });

  it("ignores padded decoy entries with count 0", () => {
    expect(isSuffixBreached(`${SUFFIX}:0`, SUFFIX)).toBe(false);
  });

  it("returns false when the suffix is absent", () => {
    expect(isSuffixBreached("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:5", SUFFIX)).toBe(
      false,
    );
  });

  it("tolerates CRLF line endings and lowercase input", () => {
    expect(isSuffixBreached(`${SUFFIX.toLowerCase()}:12\r\n`, SUFFIX)).toBe(true);
  });
});
