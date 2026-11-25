// Readable names for audit actions and targets. Lives outside ops-dashboard
// so the person's record uses the same labels instead of the raw code
// ("user.account_block") (I-10). Unknown action becomes text with spaces.
const auditActionLabels: Record<string, string> = {
  "refund.requested": "actions.refundRequested",
  "refund.issued": "actions.refundIssued",
  "account.deletion_requested": "actions.deletionRequested",
  "account.data_export_requested": "actions.exportRequested",
  "user.account_suspend": "actions.accountSuspended",
  "user.account_block": "actions.accountBlocked",
  "user.account_restore": "actions.accountRestored",
};

const auditTargetLabels: Record<string, string> = {
  order: "targets.order",
  user: "targets.user",
  course: "targets.course",
};

function formatLabel(value: string, labels: Record<string, string>, t: (key: string) => string) {
  return Object.hasOwn(labels, value) ? t(`platform.ops.auditPanel.${labels[value]}`) : value.replace(/[._]/g, " ");
}

export function formatAuditAction(value: string, t: (key: string) => string) {
  return formatLabel(value, auditActionLabels, t);
}

export function formatAuditTarget(value: string, t: (key: string) => string) {
  return formatLabel(value, auditTargetLabels, t);
}
