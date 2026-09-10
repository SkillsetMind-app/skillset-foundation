import { NextResponse } from "next/server";
import { PaymentError } from "@/lib/payments/server/auth";

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function failure(status: number, error = "Could not update access. Please try again.") {
  return NextResponse.json({ error }, { status });
}
export function databaseFailure(error: { code?: string }) {
  if (error.code === "42501") return failure(403, "This action requires the appropriate account permissions and verification.");
  if (["22023", "23505", "P0002"].includes(error.code ?? "")) return failure(409, "The invitation or account is unavailable. Check its details and status.");
  return failure(500);
}
export function caughtFailure(error: unknown) {
  return error instanceof PaymentError ? failure(error.status, error.message) : failure(500);
}
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

/** Bound the stream before parsing, including requests without Content-Length. */
export async function readSmallObject(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new PaymentError("Invalid request.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        throw new PaymentError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new PaymentError("Invalid request.", 400); }
}
