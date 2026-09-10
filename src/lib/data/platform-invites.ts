"use client";

import type { CreatePlatformInvite, PlatformInvite, PlatformInviteDelivery } from "@/domain/platform-invites";
import { PaymentRequestError, postPaymentRoute } from "@/lib/payments/client-fetch";

const endpoint = "/api/operations/invitations";

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new PaymentRequestError("Could not load access information.", response.status);
  return response.json() as Promise<T>;
}

export async function listPlatformInvites(): Promise<PlatformInvite[]> {
  return (await get<{ invites: PlatformInvite[] }>(endpoint)).invites;
}
export function createPlatformInvite(input: CreatePlatformInvite): Promise<PlatformInviteDelivery> {
  return postPaymentRoute(endpoint, { action: "create", ...input });
}
export function resendPlatformInvite(id: string): Promise<PlatformInviteDelivery> {
  return postPaymentRoute(endpoint, { action: "resend", inviteId: id });
}
export async function revokePlatformInvite(id: string): Promise<void> {
  await postPaymentRoute(endpoint, { action: "revoke", inviteId: id });
}
export async function setActivationWaiver(uid: string, waived: boolean): Promise<void> {
  await postPaymentRoute(endpoint, { action: "waive", uid, waived });
}
export async function getMyPlatformInvite(id: string): Promise<PlatformInvite> {
  return (await get<{ invite: PlatformInvite }>(`/api/invitations/${encodeURIComponent(id)}`)).invite;
}
export async function acceptPlatformInvite(id: string): Promise<{ next_path: string }> {
  const result = await postPaymentRoute<{ next_path: string }>(`/api/invitations/${encodeURIComponent(id)}`);
  if (!["/ops", "/learn", "/onboarding?path=teacher"].includes(result.next_path)) {
    throw new Error("Invitation destination unavailable.");
  }
  return result;
}
