/**
 * Immutable audit trail for sensitive, privileged, or money-moving actions.
 *
 * Entries are written EXCLUSIVELY by Cloud Functions through the Admin SDK
 * (which bypasses Firestore security rules). Client writes to the `auditLog`
 * collection are denied by the rules — the admin dashboard only ever reads.
 *
 * This module is intentionally PURE (no firebase-admin imports) so the entry
 * builder can be unit tested directly. The thin Firestore writer lives in
 * index.ts, where the Admin SDK handles (db, FieldValue, logger) already exist.
 */

export const AUDIT_LOG_COLLECTION = "auditLog";

export const AUDIT_ACTIONS = {
  REFUND_REQUESTED: "refund.requested",
  REFUND_ISSUED: "refund.issued",
  ACCOUNT_DELETION_REQUESTED: "account.deletion_requested",
  ACCOUNT_DATA_EXPORT_REQUESTED: "account.data_export_requested",
  COURSE_DELETED_BY_ADMIN: "course.deleted_by_admin",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditMetadataValue = string | number | boolean | null;

/**
 * Caller-facing input. `metadata` is intentionally permissive (unknown
 * values) so call sites never need casts; unsafe values are dropped during
 * normalization rather than persisted.
 */
export interface AuditEventInput {
  action: AuditAction;
  actorId: string;
  actorEmail?: string | null;
  targetType: string;
  targetId: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

/** Validated, persistence-ready shape (without the server timestamp). */
export interface AuditEntry {
  action: AuditAction;
  actorId: string;
  actorEmail: string | null;
  targetType: string;
  targetId: string;
  summary: string;
  metadata: Record<string, AuditMetadataValue>;
}

const SUMMARY_MAX_LENGTH = 280;
const METADATA_MAX_KEYS = 20;
const METADATA_STRING_MAX_LENGTH = 500;

function requireText(value: string, field: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (trimmed.length === 0) {
    throw new Error(`Audit entry ${field} is required.`);
  }

  return trimmed;
}

/**
 * Keep only Firestore-friendly primitives. Objects, arrays, undefined, NaN,
 * and Infinity are dropped so a malformed caller can never persist junk or a
 * value Firestore would reject.
 */
function normalizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, AuditMetadataValue> {
  if (!metadata) {
    return {};
  }

  const normalized: Record<string, AuditMetadataValue> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (Object.keys(normalized).length >= METADATA_MAX_KEYS) {
      break;
    }

    const safeKey = key.trim();

    if (safeKey.length === 0) {
      continue;
    }

    if (typeof value === "string") {
      normalized[safeKey] = value.slice(0, METADATA_STRING_MAX_LENGTH);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      normalized[safeKey] = value;
    } else if (typeof value === "boolean" || value === null) {
      normalized[safeKey] = value;
    }
  }

  return normalized;
}

/**
 * Pure builder — validates and normalizes an audit event into the persisted
 * shape. Deterministic and side-effect free. Throws on missing required
 * fields so callers never persist a junk entry.
 */
export function buildAuditEntry(input: AuditEventInput): AuditEntry {
  return {
    action: input.action,
    actorId: requireText(input.actorId, "actorId"),
    actorEmail:
      typeof input.actorEmail === "string" && input.actorEmail.trim().length > 0
        ? input.actorEmail.trim()
        : null,
    targetType: requireText(input.targetType, "targetType"),
    targetId: requireText(input.targetId, "targetId"),
    summary: requireText(input.summary, "summary").slice(0, SUMMARY_MAX_LENGTH),
    metadata: normalizeMetadata(input.metadata),
  };
}
