// Postgres returns timestamps as ISO strings. Legacy Firestore rows exposed
// { toDate() } / { toMillis() } / { seconds }. This one parser accepts all of
// them (plus a Date and an epoch-millis number) so date/money surfaces stop
// silently rendering "Date pending" and sorting by 0 on real Postgres rows.
// The null return is load-bearing: callers do `toDate(v)?.getTime() ?? fallback`,
// and `new Date(null)` would wrongly yield the epoch instead of "no date".
export function toDate(value: unknown): Date | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object") {
    const ts = value as {
      toDate?: () => Date;
      toMillis?: () => number;
      seconds?: number;
    };
    if (typeof ts.toDate === "function") {
      try {
        const date = ts.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
      } catch {
        return null;
      }
    }
    if (typeof ts.toMillis === "function") {
      const date = new Date(ts.toMillis());
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof ts.seconds === "number") {
      const date = new Date(ts.seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  return null;
}
