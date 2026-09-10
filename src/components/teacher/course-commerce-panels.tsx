"use client";

import Link from "next/link";
import { useTranslation } from "@/components/i18n/i18n-provider";
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

const taxRegionKeys: Record<TaxRegion, string> = {
  "United States": "courseCommerce.regionus",
  Brazil: "courseCommerce.regionbr",
  "European Union": "courseCommerce.regioneu",
  "United Kingdom": "courseCommerce.regionuk",
  Other: "courseCommerce.regionother",
};

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

function GateNotice() {
  const { t } = useTranslation();
  return (
    <InlineAlert tone="warning" className="mt-3 font-normal leading-6">
      {t("courseCommerce.gate")}{" "}
      <Link
        href="/teach/verification"
        className="font-semibold text-[var(--color-primary)] underline"
      >
        {t("courseCommerce.openVerification")}
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
  const { t } = useTranslation();
  if (error) {
    return (
      <InlineAlert tone="error" className="mt-3">
        {t(error)}
      </InlineAlert>
    );
  }
  if (notice) {
    return (
      <InlineAlert tone="success" className="mt-3">
        {t(notice)}
      </InlineAlert>
    );
  }
  return null;
}

const commerceErrorKeys: Record<string, string> = {
  "Coupon codes use 3-24 letters, numbers, or dashes.": "courseCommerce.invalidCode",
  "Redemption limit must be between 1 and 100000, or blank for unlimited.": "courseCommerce.invalidLimit",
  "Discount must be between 5% and 90%.": "courseCommerce.invalidDiscount",
  "The expiry date must be in the future.": "courseCommerce.expiryPast",
  "This course already has 50 coupons — remove one first.": "courseCommerce.couponLimit",
  "That coupon code already exists for this course.": "courseCommerce.duplicateCode",
  "Coupon not found.": "courseCommerce.notFound",
  "This coupon has expired — create a new one instead.": "courseCommerce.expiredError",
  "Professional verification must be approved before a coupon can be activated.": "courseCommerce.verificationError",
  "Only the course owner can manage its coupons.": "courseCommerce.ownerError",
  "Tax regions must be a list.": "courseCommerce.regionsList",
  "Pick at most 5 tax regions.": "courseCommerce.regionsLimit",
  "Unknown tax region.": "courseCommerce.regionUnknown",
  "Keep the tax registration under 80 characters.": "courseCommerce.registrationLong",
};

function toMessageKey(error: unknown, fallback: string): string {
  const message = error && typeof error === "object" && "message" in error
    && typeof error.message === "string" ? error.message : "";
  return Object.hasOwn(commerceErrorKeys, message) ? commerceErrorKeys[message] : fallback;
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
  const { t, locale } = useTranslation();
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
      setError("courseCommerce.invalidCode");
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
      setError("courseCommerce.invalidLimit");
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
      setNotice("courseCommerce.created");
    } catch (createError) {
      setError(toMessageKey(createError, "courseCommerce.createError"));
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
      setError(toMessageKey(toggleError, "courseCommerce.updateError"));
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
      setError(toMessageKey(removeError, "courseCommerce.removeError"));
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
      title={t("courseCommerce.coupons")}
      description={t("courseCommerce.couponsHelp")}
    >
      {activationBlocked ? <GateNotice /> : null}
      <form onSubmit={handleCreate} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field id="coupon-code" label={t("courseCommerce.code")} required>
          {(a11y) => (
            <input
              {...a11y}
              value={code}
              onChange={(event) => setCode(normalizeCouponCode(event.target.value))}
              placeholder={t("courseCommerce.codePlaceholder")}
              className={inputClass}
            />
          )}
        </Field>
        <Field id="coupon-discount" label={t("courseCommerce.discount")}>
          {(a11y) => (
            <select
              {...a11y}
              value={percentOff}
              onChange={(event) => setPercentOff(Number(event.target.value))}
              className={inputClass}
            >
              {COUPON_PERCENT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t("courseCommerce.percentOff").replace("{percent}", () => String(option))}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          id="coupon-max-redemptions"
          label={t("courseCommerce.limit")}
        >
          {(a11y) => (
            <input
              {...a11y}
              type="number"
              min={1}
              max={100000}
              value={maxRedemptionsText}
              onChange={(event) => setMaxRedemptionsText(event.target.value)}
              placeholder={t("courseCommerce.unlimited")}
              className={inputClass}
            />
          )}
        </Field>
        <Field id="coupon-expires-on" label={t("courseCommerce.expires")}>
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
            {saving ? t("courseCommerce.creating") : t("courseCommerce.create")}
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
                      {t("courseCommerce.percentOff").replace("{percent}", () => String(coupon.percentOff))}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    {coupon.maxRedemptions === null
                      ? t("courseCommerce.unlimitedUses")
                      : t("courseCommerce.uses").replace("{count}", () => String(coupon.maxRedemptions))}
                    {coupon.expiresAt
                      ? t("courseCommerce.expiresAt").replace("{date}", () => new Date(coupon.expiresAt!).toLocaleDateString(locale, { timeZone: "UTC" }))
                      : t("courseCommerce.noExpiry")}
                    {" - "}
                    {expired ? t("courseCommerce.expired") : coupon.active ? t("courseCommerce.active") : t("courseCommerce.paused")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!expired ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleToggle(coupon)}
                    >
                      {coupon.active ? t("courseCommerce.pause") : t("courseCommerce.activate")}
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
                        {removingId === coupon.id ? t("courseCommerce.removing") : t("courseCommerce.confirmRemove")}
                      </button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmingDeleteId(null)}
                        disabled={removingId === coupon.id}
                      >
                        {t("courseCommerce.cancel")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmingDeleteId(coupon.id)}
                    >
                      {t("courseCommerce.remove")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
          {t("courseCommerce.empty")}
        </p>
      )}
    </PanelCard>
  );
}

export function TaxPanel({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
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
      setNotice("courseCommerce.saved");
    } catch (saveError) {
      setError(toMessageKey(saveError, "courseCommerce.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelCard
      title={t("courseCommerce.tax")}
      description={t("courseCommerce.taxHelp")}
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
            {t("courseCommerce.collect")}
          </span>
        </label>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
            {t("courseCommerce.regions")}
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
                <span className="text-sm text-[var(--color-ink)]">{t(taxRegionKeys[region])}</span>
              </label>
            ))}
          </div>
        </div>
        <Field id="tax-registration-id" label={t("courseCommerce.registration")}>
          {(a11y) => (
            <input
              {...a11y}
              value={registrationId}
              onChange={(event) => setRegistrationId(event.target.value)}
              maxLength={80}
              placeholder={t("courseCommerce.registrationPlaceholder")}
              className={`${inputClass} sm:max-w-sm`}
            />
          )}
        </Field>
        <div>
          <Button type="submit" disabled={saving || !settingsLoaded}>
            {saving ? t("courseCommerce.saving") : t("courseCommerce.save")}
          </Button>
        </div>
      </form>
      <FeedbackText error={error} notice={notice} />
    </PanelCard>
  );
}
