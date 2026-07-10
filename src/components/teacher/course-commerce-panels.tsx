"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import type {
  CourseCommerceSettings,
  CourseCoproducer,
  CourseCoupon,
  TaxRegion,
  UpsertCourseCommerceSettingsInput,
} from "@/domain/course-commerce";
import {
  AFFILIATE_COMMISSION_MAX,
  AFFILIATE_COMMISSION_MIN,
  COUPON_PERCENT_OPTIONS,
  isCouponExpired,
  isValidCouponCode,
  normalizeCouponCode,
  remainingCoproducerShare,
  TAX_REGIONS,
} from "@/domain/course-commerce";
import {
  createCourseCoupon,
  deleteCourseCoupon,
  inviteCourseCoproducer,
  revokeCourseCoproducer,
  setCourseCouponActive,
  subscribeToCourseCommerceSettings,
  subscribeToCourseCoproducers,
  subscribeToCourseCoupons,
  upsertCourseCommerceSettings,
} from "@/lib/data/course-commerce";
import { logSubscriptionError } from "@/lib/data/subscription-error";

// Commerce panels for the per-course management central. Configuration is
// real and persisted; the activation actions (enable affiliates, activate a
// coupon) are gated server-side on professional verification while the
// admission flag is on. Redemption at checkout, affiliate attribution, and
// co-producer settlement are separate engines — every panel says so instead
// of implying they already run.

const inputClass =
  "rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]";

export function PanelCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-5">
      <h3 className="text-base font-semibold text-[var(--color-ink)]">{title}</h3>
      {description ? (
        <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function GateNotice({ action }: { action: string }) {
  return (
    <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.18)] bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
      Professional verification must be approved before {action}. You can
      prepare everything now — approval unlocks the switch.{" "}
      <Link
        href="/teach/verification"
        className="font-semibold text-[var(--color-primary)] underline"
      >
        Open verification
      </Link>
    </p>
  );
}

function FeedbackText({
  error,
  notice,
}: {
  error: string;
  notice: string;
}) {
  if (error) {
    return (
      <p className="mt-3 text-sm font-semibold text-[var(--color-accent-fg)]">
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p className="mt-3 text-sm font-semibold text-[var(--color-primary)]">
        {notice}
      </p>
    );
  }
  return null;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The affiliate and tax panels edit disjoint slices of the same settings row
 * through one full-row RPC, so each save merges its edits over the last
 * loaded snapshot (or these defaults when the row doesn't exist yet).
 */
function settingsToInput(
  courseId: string,
  settings: CourseCommerceSettings | null,
): UpsertCourseCommerceSettingsInput {
  return {
    courseId,
    affiliateEnabled: settings?.affiliateEnabled ?? false,
    affiliateCommissionPct: settings?.affiliateCommissionPct ?? 25,
    affiliateApproval: settings?.affiliateApproval ?? "manual",
    taxCollection: settings?.taxCollection ?? false,
    taxRegions: settings?.taxRegions ?? [],
    taxRegistrationId: settings?.taxRegistrationId,
  };
}

export function CouponsPanel({
  courseId,
  activationBlocked,
}: {
  courseId: string;
  activationBlocked: boolean;
}) {
  const [coupons, setCoupons] = useState<CourseCoupon[]>([]);
  const [code, setCode] = useState("");
  const [percentOff, setPercentOff] = useState(10);
  // Numeric fields keep the raw string while typing and parse on submit —
  // snapping to a fallback mid-keystroke mangles normal input.
  const [maxRedemptionsText, setMaxRedemptionsText] = useState("100");
  const [expiresOn, setExpiresOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    return subscribeToCourseCoupons(
      courseId,
      setCoupons,
      logSubscriptionError("CouponsPanel"),
    );
  }, [courseId]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!isValidCouponCode(code)) {
      setError("Coupon codes use 3-24 letters, numbers, or dashes.");
      return;
    }
    const maxRedemptions = Number(maxRedemptionsText);
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100000) {
      setError("Redemption limit must be between 1 and 100000.");
      return;
    }
    setSaving(true);
    try {
      await createCourseCoupon({
        courseId,
        code,
        percentOff,
        maxRedemptions,
        // Anchored to UTC end-of-day so the stored instant and the rendered
        // date agree for every viewer, regardless of timezone.
        expiresAt: expiresOn
          ? new Date(`${expiresOn}T23:59:59Z`).toISOString()
          : undefined,
      });
      setCode("");
      setExpiresOn("");
      setNotice("Coupon created — it starts paused until you activate it.");
    } catch (createError) {
      setError(toMessage(createError, "Could not create the coupon."));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (coupon: CourseCoupon) => {
    setError("");
    setNotice("");
    try {
      await setCourseCouponActive(coupon.id, !coupon.active);
    } catch (toggleError) {
      setError(toMessage(toggleError, "Could not update the coupon."));
    }
  };

  const handleRemove = async (coupon: CourseCoupon) => {
    setError("");
    setNotice("");
    try {
      await deleteCourseCoupon(coupon.id);
    } catch (removeError) {
      setError(toMessage(removeError, "Could not remove the coupon."));
    }
  };

  return (
    <PanelCard
      title="Coupons"
      description="Create discount codes for this course. New coupons start paused; checkout redemption switches on with the discount engine, so activating today prepares the code without exposing it."
    >
      {activationBlocked ? <GateNotice action="a coupon can be activated" /> : null}
      <form onSubmit={handleCreate} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Code">
          <input
            value={code}
            onChange={(event) => setCode(normalizeCouponCode(event.target.value))}
            placeholder="e.g. LAUNCH-25"
            required
            className={inputClass}
          />
        </Field>
        <Field label="Discount">
          <select
            value={percentOff}
            onChange={(event) => setPercentOff(Number(event.target.value))}
            className={inputClass}
          >
            {COUPON_PERCENT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}% off
              </option>
            ))}
          </select>
        </Field>
        <Field label="Redemption limit">
          <input
            type="number"
            min={1}
            max={100000}
            value={maxRedemptionsText}
            onChange={(event) => setMaxRedemptionsText(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Expires (optional)">
          <input
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
            className={inputClass}
          />
        </Field>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="button-solid px-5 py-2.5 text-xs disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create coupon"}
          </button>
        </div>
      </form>
      <FeedbackText error={error} notice={notice} />
      {coupons.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {coupons.map((coupon) => {
            const expired = isCouponExpired(coupon);
            return (
              <li
                key={coupon.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border fine-rule bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    {coupon.code}
                    <span className="ml-2 text-xs font-normal text-[var(--color-ink-soft)]">
                      {coupon.percentOff}% off
                    </span>
                  </p>
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    Limit {coupon.maxRedemptions} uses
                    {coupon.expiresAt
                      ? ` - expires ${new Date(coupon.expiresAt).toLocaleDateString("en-US", { timeZone: "UTC" })}`
                      : " - no expiry"}
                    {" - "}
                    {expired ? "Expired" : coupon.active ? "Active" : "Paused"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!expired ? (
                    <button
                      type="button"
                      onClick={() => void handleToggle(coupon)}
                      className="button-outline px-3 py-1.5 text-xs"
                    >
                      {coupon.active ? "Pause" : "Activate"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleRemove(coupon)}
                    className="button-outline px-3 py-1.5 text-xs"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
          No coupons yet.
        </p>
      )}
    </PanelCard>
  );
}

export function AffiliatesPanel({
  courseId,
  activationBlocked,
}: {
  courseId: string;
  activationBlocked: boolean;
}) {
  const [settings, setSettings] = useState<CourseCommerceSettings | null>(null);
  // Saving before the first snapshot arrives would merge this panel's edits
  // over defaults and wipe the other panel's saved slice — block until loaded.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [commissionText, setCommissionText] = useState("25");
  const [approval, setApproval] = useState<"manual" | "automatic">("manual");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Seed the form once per snapshot version. A save from another tab bumps
  // updatedAt and reseeds, discarding unsaved edits here — accepted tradeoff
  // to keep the form in sync with the server without dirty-state tracking.
  const seededRef = useRef<string | null>(null);

  useEffect(() => {
    return subscribeToCourseCommerceSettings(
      courseId,
      (nextSettings) => {
        setSettings(nextSettings);
        setSettingsLoaded(true);
        const seedKey = nextSettings ? nextSettings.updatedAt : "defaults";
        if (seededRef.current !== seedKey) {
          seededRef.current = seedKey;
          setEnabled(nextSettings?.affiliateEnabled ?? false);
          setCommissionText(String(nextSettings?.affiliateCommissionPct ?? 25));
          setApproval(nextSettings?.affiliateApproval ?? "manual");
        }
      },
      logSubscriptionError("AffiliatesPanel"),
    );
  }, [courseId]);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const commissionPct = Number(commissionText);
    if (
      !Number.isInteger(commissionPct) ||
      commissionPct < AFFILIATE_COMMISSION_MIN ||
      commissionPct > AFFILIATE_COMMISSION_MAX
    ) {
      setError(
        `Commission must be between ${AFFILIATE_COMMISSION_MIN}% and ${AFFILIATE_COMMISSION_MAX}%.`,
      );
      return;
    }
    setSaving(true);
    try {
      await upsertCourseCommerceSettings({
        ...settingsToInput(courseId, settings),
        affiliateEnabled: enabled,
        affiliateCommissionPct: commissionPct,
        affiliateApproval: approval,
      });
      setNotice("Affiliate program saved.");
    } catch (saveError) {
      setError(toMessage(saveError, "Could not save the affiliate program."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelCard
      title="Affiliate program"
      description="Set the terms partners earn for promoting this course. Partner sign-up, tracked links, and commission payouts ship with the attribution engine — the terms you save here are what it launches with."
    >
      {activationBlocked ? (
        <GateNotice action="the affiliate program can be enabled" />
      ) : null}
      <form onSubmit={handleSave} className="mt-4 grid gap-3">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="size-4 accent-[var(--color-primary)]"
          />
          <span className="text-sm font-semibold text-[var(--color-ink)]">
            Enable the affiliate program for this course
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Commission (${AFFILIATE_COMMISSION_MIN}-${AFFILIATE_COMMISSION_MAX}%)`}>
            <input
              type="number"
              min={AFFILIATE_COMMISSION_MIN}
              max={AFFILIATE_COMMISSION_MAX}
              value={commissionText}
              onChange={(event) => setCommissionText(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Partner approval">
            <select
              value={approval}
              onChange={(event) =>
                setApproval(event.target.value === "automatic" ? "automatic" : "manual")
              }
              className={inputClass}
            >
              <option value="manual">Manual — I approve each partner</option>
              <option value="automatic">Automatic — anyone can join</option>
            </select>
          </Field>
        </div>
        <div>
          <button
            type="submit"
            disabled={saving || !settingsLoaded}
            className="button-solid px-5 py-2.5 text-xs disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save affiliate program"}
          </button>
        </div>
      </form>
      <FeedbackText error={error} notice={notice} />
    </PanelCard>
  );
}

export function CoproducersPanel({ courseId }: { courseId: string }) {
  const [coproducers, setCoproducers] = useState<CourseCoproducer[]>([]);
  const [email, setEmail] = useState("");
  const [shareText, setShareText] = useState("20");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    return subscribeToCourseCoproducers(
      courseId,
      setCoproducers,
      logSubscriptionError("CoproducersPanel"),
    );
  }, [courseId]);

  const remainingShare = remainingCoproducerShare(coproducers);

  const handleInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const sharePct = Number(shareText);
    if (!Number.isInteger(sharePct) || sharePct < 5 || sharePct > 90) {
      setError("Revenue share must be between 5% and 90%.");
      return;
    }
    setSaving(true);
    try {
      await inviteCourseCoproducer({ courseId, email, sharePct });
      setEmail("");
      setNotice(
        "Co-producer recorded. Skillset doesn't notify them yet — share the terms with them directly.",
      );
    } catch (inviteError) {
      setError(toMessage(inviteError, "Could not record the co-producer."));
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (coproducer: CourseCoproducer) => {
    setError("");
    setNotice("");
    try {
      await revokeCourseCoproducer(coproducer.id);
    } catch (revokeError) {
      setError(toMessage(revokeError, "Could not remove the co-producer."));
    }
  };

  return (
    <PanelCard
      title="Co-producers"
      description="Record who co-created this course and their revenue share. You always keep at least 10%. Co-producer sign-in and automatic revenue splitting ship with the settlement engine — these records are its source of truth."
    >
      <form onSubmit={handleInvite} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="Practitioner email">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="partner@example.com"
            required
            className={inputClass}
          />
        </Field>
        <Field label={`Share (${remainingShare}% left)`}>
          <input
            type="number"
            min={5}
            max={90}
            value={shareText}
            onChange={(event) => setShareText(event.target.value)}
            className={inputClass}
          />
        </Field>
        <button
          type="submit"
          disabled={saving || remainingShare < 5}
          className="button-solid px-5 py-2.5 text-xs disabled:opacity-60"
        >
          {saving ? "Adding..." : "Add co-producer"}
        </button>
      </form>
      {remainingShare < 5 ? (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          The 90% combined share cap is reached — remove a co-producer to free
          up room.
        </p>
      ) : null}
      <FeedbackText error={error} notice={notice} />
      {coproducers.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {coproducers.map((coproducer) => (
            <li
              key={coproducer.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border fine-rule bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
                  {coproducer.inviteeEmail}
                </p>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  {coproducer.revenueSharePct}% share -{" "}
                  {coproducer.status === "accepted" ? "Accepted" : "Recorded"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRevoke(coproducer)}
                className="button-outline px-3 py-1.5 text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
          No co-producers yet.
        </p>
      )}
    </PanelCard>
  );
}

export function TaxPanel({ courseId }: { courseId: string }) {
  const [settings, setSettings] = useState<CourseCommerceSettings | null>(null);
  // Same guard as AffiliatesPanel: saving before the first snapshot would
  // overwrite the affiliate slice with defaults.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [collection, setCollection] = useState(false);
  const [regions, setRegions] = useState<TaxRegion[]>([]);
  const [registrationId, setRegistrationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Reseeds on every snapshot version — see the note in AffiliatesPanel.
  const seededRef = useRef<string | null>(null);

  useEffect(() => {
    return subscribeToCourseCommerceSettings(
      courseId,
      (nextSettings) => {
        setSettings(nextSettings);
        setSettingsLoaded(true);
        const seedKey = nextSettings ? nextSettings.updatedAt : "defaults";
        if (seededRef.current !== seedKey) {
          seededRef.current = seedKey;
          setCollection(nextSettings?.taxCollection ?? false);
          setRegions(nextSettings?.taxRegions ?? []);
          setRegistrationId(nextSettings?.taxRegistrationId ?? "");
        }
      },
      logSubscriptionError("TaxPanel"),
    );
  }, [courseId]);

  const toggleRegion = (region: TaxRegion) => {
    setRegions((current) =>
      current.includes(region)
        ? current.filter((candidate) => candidate !== region)
        : [...current, region],
    );
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      await upsertCourseCommerceSettings({
        ...settingsToInput(courseId, settings),
        taxCollection: collection,
        taxRegions: regions,
        taxRegistrationId: registrationId.trim() || undefined,
      });
      setNotice("Tax settings saved.");
    } catch (saveError) {
      setError(toMessage(saveError, "Could not save the tax settings."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelCard
      title="Tax collection"
      description="Record where you're registered to collect tax for this course. Automatic tax calculation at checkout ships with the tax engine — until then this is your declaration, kept with the course."
    >
      <form onSubmit={handleSave} className="mt-4 grid gap-3">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={collection}
            onChange={(event) => setCollection(event.target.checked)}
            className="size-4 accent-[var(--color-primary)]"
          />
          <span className="text-sm font-semibold text-[var(--color-ink)]">
            I collect tax on sales of this course
          </span>
        </label>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
            Regions
          </p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {TAX_REGIONS.map((region) => (
              <label key={region} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={regions.includes(region)}
                  onChange={() => toggleRegion(region)}
                  className="size-4 accent-[var(--color-primary)]"
                />
                <span className="text-sm text-[var(--color-ink)]">{region}</span>
              </label>
            ))}
          </div>
        </div>
        <Field label="Tax registration ID (optional)">
          <input
            value={registrationId}
            onChange={(event) => setRegistrationId(event.target.value)}
            maxLength={80}
            placeholder="e.g. VAT or EIN reference"
            className={`${inputClass} sm:max-w-sm`}
          />
        </Field>
        <div>
          <button
            type="submit"
            disabled={saving || !settingsLoaded}
            className="button-solid px-5 py-2.5 text-xs disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save tax settings"}
          </button>
        </div>
      </form>
      <FeedbackText error={error} notice={notice} />
    </PanelCard>
  );
}
