// Google OAuth only renders when the Supabase provider is actually enabled —
// with the provider off, clicking the button dead-ends on "provider is not
// enabled". Flip NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true (Vercel env + redeploy)
// after enabling Google under Supabase Auth → Providers.
export const isGoogleAuthEnabled =
  process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
