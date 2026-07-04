// Bunny Stream — client-safe config. The library id is public (it appears in
// every embed URL), so it doubles as the feature flag: when it is set, video
// uploads/playback route through Bunny; when unset, they fall back to Supabase
// Storage. The API key and token-auth key are server-only and live in
// bunny/server.ts, never here.
export const bunnyLibraryId =
  process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID ?? "";

export const isBunnyConfigured = bunnyLibraryId.length > 0;
