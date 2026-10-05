// Pure, so client components can validate an id without pulling in the server
// helpers that operations/http re-exports this from.
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
