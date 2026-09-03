"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { Button, Card, Field, InlineAlert } from "@/components/ui";
import type {
  CourseCommerceSettings,
  CourseCoupon,
  TaxRegion,
  UpsertCourseCommerceSettingsInput,
} from "@/domain/course-commerce";
import {
  COUPON_PERCENT_OPTIONS,
  isCouponExpired,
  isValidCouponCode,
  normalizeCouponCode,
  TAX_REGIONS,
} from "@/domain/course-commerce";
import {
  createCourseCoupon,
  deleteCourseCoupon,
  setCourseCouponActive,
  subscribeToCourseCommerceSettings,
  subscribeToCourseCoupons,
  upsertCourseCommerceSettings,
} from "@/lib/data/course-commerce";
import { logSubscriptionError } from "@/lib/data/subscription-error";

// Commerce panels for the per-course management central. Configuration is real
// and persisted; activating a coupon is gated server-side on professional
// verification while the admission flag is on. Redemption at checkout is live
// for one-time and subscription buys alike — see the note above buildCoupon.
//
// Affiliate and co-producer panels were removed with the pivot to Stripe direct
// charges: the buyer pays the teacher's account directly, so the platform never
// holds the money and cannot split it with a third party.

const inputClass =
  "rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]";

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
    <Card as="section" tone="soft" padding="none" shadow={false} className="p-5">
      <h3 className="text-base font-semibold text-[var(--color-ink)]">{title}</h3>
      {description ? (
        <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
          {description}
        </p>
      ) : null}
      {children}
    </Card>
  );
}

function GateNotice({ action }: { action: string }) {
  return (
    <InlineAlert tone="warning" className="mt-3 font-normal leading-6">
      Professional verification must be approved before {action}. You can
      prepare everything now — approval unlocks the switch.{" "}
      <Link
        href="/teach/verification"
        className="font-semibold text-[var(--color-primary)] underline"
      >
        Open verification
      </Link>
    </InlineAlert>
  );
}

/**
 * O texto de retorno era um <p> colorido sem papel nenhum: a falha de criar um
 * cupom e o "salvo com sucesso" entravam na página em silêncio. Agora o erro
 * interrompe o leitor de tela e o aviso de sucesso entra na fila educada.
 */
function FeedbackText({
  error,
  notice,
}: {
  error: string;
  notice: string;
}) {
  if (error) {
    return (
      <InlineAlert tone="error" className="mt-3">
        {error}
      </InlineAlert>
    );
  }
  if (notice) {
    return (
      <InlineAlert tone="success" className="mt-3">
        {notice}
      </InlineAlert>
    );
  }
  return null;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The settings row is written through one full-row RPC, so a save merges its
 * edits over the last loaded snapshot (or these defaults when the row doesn't
 * exist yet).
 */
function settingsToInput(
  courseId: string,
  settings: CourseCommerceSettings | null,
): UpsertCourseCommerceSettingsInput {
  return {
    courseId,
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
  // snapping to a fallback mid-keystroke mangles normal input. Blank is the
  // default and means unlimited, matching every other marketplace.
  const [maxRedemptionsText, setMaxRedemptionsText] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Deleting a coupon is irreversible and its button sits next to the
  // reversible "Pause" in identical styling. Same two-step confirm every
  // other destructive control in the Studio uses.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

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
    // Blank == unlimited. Number("") is 0, so the emptiness check has to come
    // first or "no limit" would fail the range check as a zero.
    const limitText = maxRedemptionsText.trim();
    const maxRedemptions = limitText === "" ? null : Number(limitText);
    if (
      maxRedemptions !== null
      && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100000)
    ) {
      setError("Redemption limit must be between 1 and 100000, or blank for unlimited.");
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
    setRemovingId(coupon.id);
    try {
      await deleteCourseCoupon(coupon.id);
      setConfirmingDeleteId(null);
    } catch (removeError) {
      setError(toMessage(removeError, "Could not remove the coupon."));
    } finally {
      setRemovingId(null);
    }
  };

  // Redemption is live for both one-time and subscription checkouts. On a
  // recurring course the discount applies to the FIRST payment only:
  // `course_coupons` has no duration column, so a percent that repeated
  // forever would be unremovable for subscribers already on it.
  return (
    <PanelCard
      title="Coupons"
      description="Create discount codes for this course. New coupons start paused until you activate them. On a subscription course the discount applies to the first payment only."
    >
      {activationBlocked ? <GateNotice action="a coupon can be activated" /> : null}
      <form onSubmit={handleCreate} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field id="coupon-code" label="Code" required>
          {(a11y) => (
            <input
              {...a11y}
              value={code}
              onChange={(event) => setCode(normalizeCouponCode(event.target.value))}
              placeholder="e.g. LAUNCH-25"
              className={inputClass}
            />
          )}
        </Field>
        <Field id="coupon-discount" label="Discount">
          {(a11y) => (
            <select
              {...a11y}
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
          )}
        </Field>
        <Field
          id="coupon-max-redemptions"
          label="Redemption limit (optional)"
        >
          {(a11y) => (
            <input
              {...a11y}
              type="number"
              min={1}
              max={100000}
              value={maxRedemptionsText}
              onChange={(event) => setMaxRedemptionsText(event.target.value)}
              placeholder="Unlimited"
              className={inputClass}
            />
          )}
        </Field>
        <Field id="coupon-expires-on" label="Expires (optional)">
          {(a11y) => (
            <input
              {...a11y}
              type="date"
              value={expiresOn}
              onChange={(event) => setExpiresOn(event.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Creating..." : "Create coupon"}
          </Button>
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
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border fine-rule bg-[var(--color-surface)] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    {coupon.code}
                    <span className="ml-2 text-xs font-normal text-[var(--color-ink-soft)]">
                      {coupon.percentOff}% off
                    </span>
                  </p>
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    {coupon.maxRedemptions === null
                      ? "Unlimited uses"
                      : `Limit ${coupon.maxRedemptions} uses`}
                    {coupon.expiresAt
                      ? ` - expires ${new Date(coupon.expiresAt).toLocaleDateString("en-US", { timeZone: "UTC" })}`
                      : " - no expiry"}
                    {" - "}
                    {expired ? "Expired" : coupon.active ? "Active" : "Paused"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!expired ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleToggle(coupon)}
                    >
                      {coupon.active ? "Pause" : "Activate"}
                    </Button>
                  ) : null}
                  {confirmingDeleteId === coupon.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleRemove(coupon)}
                        disabled={removingId === coupon.id}
                        className="button-accent px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        {removingId === coupon.id ? "Removing..." : "Confirm remove"}
                      </button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmingDeleteId(null)}
                        disabled={removingId === coupon.id}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmingDeleteId(coupon.id)}
                    >
                      Remove
                    </Button>
                  )}
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

export function TaxPanel({ courseId }: { courseId: string }) {
  const [settings, setSettings] = useState<CourseCommerceSettings | null>(null);
  // Saving before the first snapshot arrives would write defaults over the
  // stored row, so block the form until it has loaded.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [collection, setCollection] = useState(false);
  const [regions, setRegions] = useState<TaxRegion[]>([]);
  const [registrationId, setRegistrationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Reseeds on every snapshot version: a save from another tab bumps updatedAt
  // and discards unsaved edits here, keeping the form in sync with the server.
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
        <Field id="tax-registration-id" label="Tax registration ID (optional)">
          {(a11y) => (
            <input
              {...a11y}
              value={registrationId}
              onChange={(event) => setRegistrationId(event.target.value)}
              maxLength={80}
              placeholder="e.g. VAT or EIN reference"
              className={`${inputClass} sm:max-w-sm`}
            />
          )}
        </Field>
        <div>
          <Button type="submit" disabled={saving || !settingsLoaded}>
            {saving ? "Saving..." : "Save tax settings"}
          </Button>
        </div>
      </form>
      <FeedbackText error={error} notice={notice} />
    </PanelCard>
  );
}
