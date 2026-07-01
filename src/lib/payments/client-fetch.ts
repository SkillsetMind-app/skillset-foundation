"use client";

// Shared client → payment Route Handler POST. A same-origin fetch carries the
// Supabase auth cookie automatically (the routes call requireUserId(), which
// reads it server-side), so there is no manual token to pass. On a non-2xx
// response, throws a PaymentRequestError carrying the server's { error, code }
// so callers can branch on the code (e.g. isConnectNotEnabledError).

export class PaymentRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "PaymentRequestError";
    this.status = status;
    this.code = code;
  }
}

export async function postPaymentRoute<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };

  if (!response.ok) {
    throw new PaymentRequestError(
      data.error || "Payment request failed.",
      response.status,
      data.code,
    );
  }

  return data;
}
