export const platformAccessLevels = ["student", "teacher", "staff", "admin"] as const;
export type PlatformAccessLevel = (typeof platformAccessLevels)[number];
export type PlatformInvite = {
  id: string;
  email: string;
  access_level: PlatformAccessLevel;
  waive_activation: boolean;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  activation_pending?: boolean;
};

export type CreatePlatformInvite = {
  email: string;
  accessLevel: PlatformAccessLevel;
  waiveActivation: boolean;
};

export type PlatformInviteDelivery = {
  invite: PlatformInvite;
  emailStatus: "sent" | "failed";
};
