import { timingSafeEqual } from "node:crypto";

// Vercel Cron and the GitHub schedule both call with the header
// "Bearer <CRON_SECRET>". Unset CRON_SECRET means closed, never "open to all".
export function isCronRequest(request: Request): boolean {
  const expectedValue = process.env.CRON_SECRET;
  if (!expectedValue) return false;
  const expected = Buffer.from(`Bearer ${expectedValue}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  // timingSafeEqual throws when the buffers differ in length, so length is
  // compared first — that leaks the length and nothing more, while the byte
  // comparison stays constant-time.
  return expected.length === received.length && timingSafeEqual(expected, received);
}
