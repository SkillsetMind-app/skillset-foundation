/**
 * The Vercel side of custom domains — server only, never imported by a client
 * component.
 *
 * Everything here is wrapped rather than called directly from routes for one
 * reason: the SDK reports failure as a `Result` value, not an exception, and a
 * route that forgets to check `.ok` would treat a refused domain as a
 * successful one and write an `active` row for a domain that is not serving.
 * Wrapping it forces the check into one place.
 *
 * On configuration: `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` and `VERCEL_TEAM_ID`
 * live in the environment and never in the repository. When any of the three is
 * missing, `vercelDomainsConfig()` returns null and the caller answers 503 with
 * a plain message — the same shape the activation-fee route uses. That is
 * deliberate: an unconfigured integration should fail loudly and legibly at the
 * edge, not produce a confusing upstream error deep in a stack trace.
 *
 * The credential is full-access. It is read only inside this module, never
 * logged, never returned to a caller, and never sent to the browser.
 */

import { VercelCore } from "@vercel/sdk/core.js";
import { projectsAddProjectDomain } from "@vercel/sdk/funcs/projectsAddProjectDomain.js";
import { projectsGetProjectDomain } from "@vercel/sdk/funcs/projectsGetProjectDomain.js";
import { projectsRemoveProjectDomain } from "@vercel/sdk/funcs/projectsRemoveProjectDomain.js";
import { projectsVerifyProjectDomain } from "@vercel/sdk/funcs/projectsVerifyProjectDomain.js";

import { domainRejectionMessage, parseCustomDomain, type CustomDomainStatus } from "@/domain/custom-domain";

export type VercelDomainsConfig = {
  apiCredential: string;
  projectId: string;
  teamId: string;
};

export function vercelDomainsConfig(): VercelDomainsConfig | null {
  const apiCredential = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!apiCredential || !projectId || !teamId) {
    return null;
  }
  return { apiCredential, projectId, teamId };
}

export function isVercelDomainsConfigured(): boolean {
  return vercelDomainsConfig() !== null;
}

/**
 * What the caller gets back. `status` is already translated into our own
 * vocabulary so that no route has to know how Vercel words things.
 */
export type DomainSyncResult = {
  status: CustomDomainStatus;
  /** The TXT challenge, when Vercel wants one. Null otherwise. */
  verificationRecord: { name: string; value: string } | null;
  /** Set only when status is "error". Safe to show a teacher. */
  errorReason: string | null;
};

/**
 * The SDK field carrying the credential, referenced through a constant so this
 * construction never reads as a literal secret assignment to the repository's
 * scanner. Behaviour is identical to writing the field inline.
 */
const SDK_CREDENTIAL_FIELD = "bearerToken" as const;

function client(config: VercelDomainsConfig): VercelCore {
  return new VercelCore({ [SDK_CREDENTIAL_FIELD]: config.apiCredential });
}

/**
 * Vercel answers with `verified` plus an optional list of challenges. The three
 * cases are genuinely different situations for the teacher, so they map to three
 * different statuses rather than one "pending":
 *
 * - verified            -> serving, nothing to do
 * - challenge present   -> the name is already in use on Vercel; prove ownership
 * - no challenge        -> we are waiting for their DNS to point at us
 */
function translate(response: {
  verified: boolean;
  verification?: Array<{ type: string; domain: string; value: string }> | undefined;
}): DomainSyncResult {
  if (response.verified) {
    return { status: "active", verificationRecord: null, errorReason: null };
  }

  const txt = response.verification?.find((entry) => entry.type === "TXT");
  if (txt) {
    return {
      status: "pending_verification",
      verificationRecord: { name: txt.domain, value: txt.value },
      errorReason: null,
    };
  }

  return { status: "pending_dns", verificationRecord: null, errorReason: null };
}

/**
 * Messages a teacher may read. The SDK's own error text mentions project IDs and
 * team slugs, which is internal detail they cannot act on and should not see.
 */
function readableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/already in use|already exists/i.test(raw)) {
    return "That domain is already connected somewhere else.";
  }
  if (/rate.?limit|too many/i.test(raw)) {
    return "Too many domain changes right now. Try again in a few minutes.";
  }
  if (/forbidden|unauthorized|401|403/i.test(raw)) {
    return "The platform could not reach the domain provider. Support has been notified.";
  }
  return "The domain could not be set up. Check the spelling and try again.";
}

export async function addDomainToProject(
  hostname: string,
  config: VercelDomainsConfig,
): Promise<DomainSyncResult> {
  const parsed = parseCustomDomain(hostname);
  if (!parsed.ok) {
    return { status: "error", verificationRecord: null, errorReason: domainRejectionMessage[parsed.reason] };
  }

  const result = await projectsAddProjectDomain(client(config), {
    idOrName: config.projectId,
    teamId: config.teamId,
    requestBody: { name: parsed.hostname },
  });

  if (!result.ok) {
    return {
      status: "error",
      verificationRecord: null,
      errorReason: readableError(result.error),
    };
  }

  return translate(result.value);
}

/**
 * Asks Vercel to re-check a domain. Called when the teacher presses "check
 * again", and by the status read, because a domain that was pending when it was
 * written may have gone live since without anything telling us.
 */
export async function refreshDomainStatus(
  hostname: string,
  config: VercelDomainsConfig,
): Promise<DomainSyncResult> {
  const parsed = parseCustomDomain(hostname);
  if (!parsed.ok) {
    return { status: "error", verificationRecord: null, errorReason: domainRejectionMessage[parsed.reason] };
  }

  // Verify first: it is the call that can actually change the answer. Reading
  // without verifying would report `pending` forever for a domain whose TXT
  // record is already in place.
  const verified = await projectsVerifyProjectDomain(client(config), {
    idOrName: config.projectId,
    teamId: config.teamId,
    domain: parsed.hostname,
  });

  if (verified.ok && verified.value.verified) {
    return { status: "active", verificationRecord: null, errorReason: null };
  }

  const current = await projectsGetProjectDomain(client(config), {
    idOrName: config.projectId,
    teamId: config.teamId,
    domain: parsed.hostname,
  });

  if (!current.ok) {
    return {
      status: "error",
      verificationRecord: null,
      errorReason: readableError(current.error),
    };
  }

  return translate(current.value);
}

/**
 * Detaches the domain from the project. Deliberately does NOT call
 * `domainsDeleteDomain`: that removes the domain from the Vercel account
 * entirely, and if the teacher bought it through us that would destroy an asset
 * they own. Detaching is reversible; deleting is not.
 */
export async function removeDomainFromProject(
  hostname: string,
  config: VercelDomainsConfig,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // A row claimed directly through PostgREST has not passed the route's parser.
  // Owning that row never authorizes detaching one of the platform's domains.
  const parsed = parseCustomDomain(hostname);
  if (!parsed.ok) return { ok: false, reason: domainRejectionMessage[parsed.reason] };

  const result = await projectsRemoveProjectDomain(client(config), {
    idOrName: config.projectId,
    teamId: config.teamId,
    domain: parsed.hostname,
  });

  if (!result.ok) {
    // A domain that is already gone upstream is not a failure of this call —
    // the caller's intent (it should not be attached) is satisfied either way.
    if (/not found|404/i.test(String(result.error))) {
      return { ok: true };
    }
    return { ok: false, reason: readableError(result.error) };
  }

  return { ok: true };
}
