"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { CourseShareLink } from "@/components/teacher/course-share-link";
import { CurrencySelect } from "@/components/teacher/currency-select";
import { SavedNote } from "@/components/teacher/save-status-line";
import { BusyLabel } from "@/components/ui/busy-label";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { isActivationRequiredError } from "@/domain/creator-verification";
import { paymentChoiceOf, type CoursePricingShape } from "@/domain/product-pricing";
import type { TeacherCoursePaymentType } from "@/domain/teacher-course";

type OfferPrice = {
  id: string;
  amountMinor: number;
  currency: string;
  paymentType: string;
  stripePriceId?: string | null;
  active: boolean;
};

type OfferRow = {
  id: string;
  name: string;
  isDefault: boolean;
  active: boolean;
  publicCode?: string | null;
  prices: OfferPrice[];
};

// The skin of every platform field (44px, a border that shows on white).
const inputClass = "field-input";

// The payment type comes from the API as free text. Only the four known ones have a
// translation; any other falls back to the old format instead of becoming a raw key.
const KNOWN_PAYMENT_TYPES = new Set([
  "free",
  "one_time",
  "subscription_monthly",
  "subscription_yearly",
]);

// The route's reasons that the person can resolve become the house sentence; the
// rest falls to the general sentence. The server's raw message (in English, sometimes
// technical) never goes on screen. Same mold as the coupons' toMessageKey.
const offerErrorKeys: Record<string, string> = {
  "A paid offer must have a positive price.": "creatorPanel.offers.invalidAmount",
  "A free offer must have a zero price.": "creatorPanel.offers.invalidAmount",
  "amountMinor must be a non-negative whole number.": "creatorPanel.offers.invalidAmount",
  // The attempt limit (429): the person needs to know it means wait.
  "Too many attempts. Please wait before trying again.": "creatorPanel.offers.rateError",
};

function offerErrorKey(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (isActivationRequiredError(message)) return "creatorPanel.offers.activationError";
  return Object.hasOwn(offerErrorKeys, message) ? offerErrorKeys[message] : fallback;
}

function money(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

// "Add another price" stays inside the way to pay chosen in Price,
// instead of being a second "Payment type" that could contradict the price
// step: one-time payment gets another value; monthly fee, another monthly or the
// yearly plan; free has no other price. Without the course's price (old
// call), the four forms remain.
function paymentTypesFor(coursePricing?: CoursePricingShape): TeacherCoursePaymentType[] {
  if (!coursePricing) {
    return ["one_time", "subscription_monthly", "subscription_yearly", "free"];
  }
  if (coursePricing.free) {
    return [];
  }
  return paymentChoiceOf(coursePricing.paymentType ?? "one_time") === "membership"
    ? ["subscription_monthly", "subscription_yearly"]
    : ["one_time"];
}

/**
 * Hotmart-style multi-offer list for a course.
 * Creates offer+price packages consumed by dual-read checkout.
 */
export function CourseOffersPanel({
  courseId,
  courseTitle,
  coursePricing,
  prefill,
}: {
  courseId: string;
  courseTitle: string;
  /** How the course charges today: the first offer is born from here. */
  coursePricing?: CoursePricingShape;
  /** "Add the yearly plan" from the price step: the form already opens like that. */
  prefill?: { paymentType: TeacherCoursePaymentType; amountMinor: number } | null;
}) {
  const paymentTypes = paymentTypesFor(coursePricing);
  const startWith = prefill && paymentTypes.includes(prefill.paymentType) ? prefill : null;
  const { t } = useTranslation();
  // `t` stays out of the effects' dependencies: with it there, a provider that
  // returns a new function per render resubscribes everything in a loop (the CI
  // suite went silent for 16 min). So error and warning keep the KEY and the text comes out
  // at render, in the language of the moment.
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // READ failure of the list, separate from the create error: with it the screen does not
  // know whether there is a price, so it does not say "no price" nor open the
  // create form (with the list empty it would save another main price), and it offers
  // "Try again" in place of the list (F-11).
  const [loadError, setLoadError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [notice, setNotice] = useState("");
  const [name, setName] = useState(() =>
    t(
      startWith?.paymentType === "subscription_yearly"
        ? "creatorPanel.offers.yearlyName"
        : "creatorPanel.offers.defaultName",
    ),
  );
  // The form was born with a one-time 97 USD even on a free or
  // subscription course: the screen asked to confirm a price that was not the course's.
  // A single seed, on first render — reacting to every course change
  // would erase what the person was already typing.
  const [amount, setAmount] = useState(() =>
    startWith
      ? String(startWith.amountMinor / 100)
      : coursePricing
        ? String(coursePricing.amountMinor / 100)
        : "97",
  );
  const [currency, setCurrency] = useState(coursePricing?.currency || "USD");
  const [paymentType, setPaymentType] = useState<TeacherCoursePaymentType>(
    () =>
      startWith?.paymentType
      ?? coursePricing?.paymentType
      ?? (coursePricing?.free ? "free" : "one_time"),
  );
  // The yearly plan is an extra price: it does not take the monthly's place on the page.
  const [isDefault, setIsDefault] = useState(!startWith);
  const [publicCode, setPublicCode] = useState("");
  // With an offer on the table, the table is the subject; creating another is an action, not the
  // first thing the person sees. With none, the open form guides better than
  // an empty table.
  const [creating, setCreating] = useState(Boolean(startWith));

  const paymentTypeLabel = (value: string) =>
    KNOWN_PAYMENT_TYPES.has(value)
      ? t(`creatorPanel.paymentType.${value}`)
      : value.replaceAll("_", " ");

  const hasOffers = !loading && offers.length > 0;
  const canAddPrice = paymentTypes.length > 0;
  // With no offer the form stays open: a guided empty state beats an empty table.
  const formOpen = canAddPrice && !loadError && (creating || (!loading && offers.length === 0));
  // Without a main price, checkout uses the first active price from here
  // (resolveCoursePrice). Whoever adds an extra price needs to know that.
  const hasMainPrice = offers.some((offer) => offer.isDefault && offer.active);
  const mainPriceFirst = !isDefault && !hasMainPrice && coursePricing !== undefined && !coursePricing.free;

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    setLoadError("");
    try {
      const res = await fetch(
        `/api/teach/offers?courseId=${encodeURIComponent(courseId)}`,
        { credentials: "include" },
      );
      const data = (await res.json()) as { offers?: OfferRow[]; error?: string; warning?: string };
      if (!res.ok) {
        throw new Error(data.error);
      }
      setOffers(data.offers ?? []);
      // The route answers 200 with a warning when it did not read the list: it is a read
      // failure, not "no price" (and the warning came in raw English).
      if (data.warning) {
        setLoadError("creatorPanel.offers.loadError");
      }
    } catch (failure) {
      setLoadError(offerErrorKey(failure, "creatorPanel.offers.loadError"));
      setOffers([]);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    // Defer so the effect body itself does not synchronously setState (lint).
    // Renamed from `t`: now `t` is the translator of the outer scope.
    const timer = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const amountMinor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor < 0) {
      setError("creatorPanel.offers.invalidAmount");
      setSaving(false);
      return;
    }
    const postOffer = async (offer: Record<string, unknown>) => {
      const res = await fetch("/api/teach/offers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, ...offer }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error);
      }
    };
    try {
      // An extra price never goes in alone: without a main price, checkout
      // charges the first price from here (resolveCoursePrice) and the yearly plan
      // became the page's price. The product's current price becomes the main one
      // first; set_default_product_offer rewrites the course with the same values.
      if (mainPriceFirst && coursePricing?.paymentType) {
        await postOffer({
          name: courseTitle,
          amountMinor: coursePricing.amountMinor,
          currency: coursePricing.currency,
          paymentType: coursePricing.paymentType,
          isDefault: true,
        });
        // If the second fails, the list already has the main one and trying again
        // does not create another.
        await reload();
      }
      await postOffer({ name, amountMinor, currency, paymentType, isDefault, publicCode });
      setNotice("creatorPanel.offers.created");
      setPublicCode("");
      setCreating(false);
      await reload();
    } catch (createError) {
      setError(offerErrorKey(createError, "creatorPanel.offers.createError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="course-offers-title">
      {/* tabIndex -1: "Try again" puts focus here before disappearing. */}
      <h2 ref={headingRef} tabIndex={-1} id="course-offers-title" className="text-xl font-semibold text-[var(--color-ink)]">
        {t("creatorPanel.offers.title")}
      </h2>
      {/* With an offer created, the form pushed the real list down:
          whoever already priced comes here to check or copy a link, not to
          create again. */}
      {/* "No other prices" is only true with none in the list. */}
      {canAddPrice || loading || loadError || offers.length ? null : (
        <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("creatorPanel.offers.free")}
        </p>
      )}
      {hasOffers && canAddPrice ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setCreating((open) => !open)}
            className="button-outline px-4 py-2 text-xs"
            aria-expanded={creating}
          >
            {creating
              ? t("creatorPanel.hub.pricing.newOfferCancel")
              : t("creatorPanel.hub.pricing.newOffer")}
          </button>
        </div>
      ) : null}

      {/* The shape of the incoming list (price rows), not a sentence (F-03). */}
      {loading ? (
        <div role="status" className="mt-4 grid animate-pulse gap-2">
          <span className="sr-only">{t("creatorPanel.offers.loading")}</span>
          {[0, 1].map((row) => (
            <div key={row} aria-hidden="true" className="h-14 rounded-md bg-[var(--color-surface-strong)]" />
          ))}
        </div>
      ) : loadError ? (
        <LoadErrorAlert className="mt-4" focusRef={headingRef} onRetry={reload}>
          {t(loadError)}
        </LoadErrorAlert>
      ) : offers.length ? (
        <ul className="mt-4 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {offers.map((offer) => {
            const price = offer.prices[0];
            return (
              <li
                key={offer.id}
                className="px-1 py-3"
              >
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  {offer.name}
                  {offer.isDefault ? (
                    <span className="ml-2 text-xs font-normal text-[var(--color-primary)]">
                      {t("creatorPanel.offers.defaultBadge")}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  {price
                    ? `${money(price.amountMinor, price.currency)} · ${paymentTypeLabel(price.paymentType)}`
                    : t("creatorPanel.offers.noPrice")}
                  {offer.publicCode
                    ? ` · ${t("creatorPanel.offers.code").replace("{code}", offer.publicCode)}`
                    : ""}
                  {offer.active ? "" : ` · ${t("creatorPanel.offers.inactive")}`}
                </p>
                {offer.active && price ? (
                  <CourseShareLink
                    label={t("creatorPanel.offers.checkoutLink").replace(
                      "{name}",
                      offer.name,
                    )}
                    title={courseTitle}
                    entry="pay"
                    compact
                    path={`/courses/${encodeURIComponent(courseId)}/checkout?${
                      offer.publicCode
                        ? `offer=${encodeURIComponent(offer.publicCode)}`
                        : `offerId=${encodeURIComponent(offer.id)}`
                    }`}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : canAddPrice ? (
        <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
          {t("creatorPanel.offers.empty")}
        </p>
      ) : null}

      {formOpen ? (
        <form onSubmit={(e) => void handleCreate(e)} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
              {t("creatorPanel.offers.name")}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
              {t("creatorPanel.offers.publicCode")}
            </span>
            <input
              value={publicCode}
              onChange={(e) =>
                setPublicCode(
                  e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24),
                )
              }
              placeholder={t("creatorPanel.offers.publicCodePlaceholder")}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
              {t("creatorPanel.offers.amount")}
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
              {t("creatorPanel.offers.currency")}
            </span>
            {/* It was a free-text field of three letters: it accepted "ABC", which
                Stripe refuses only at charge time. The same selector as the builder,
                with exactly the list Stripe accepts. */}
            <CurrencySelect
              value={currency}
              onChange={setCurrency}
              className={`${inputClass} w-full min-w-0`}
              aria-label={t("creatorPanel.offers.currency")}
            />
          </label>
          {paymentTypes.length > 1 ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                {t("creatorPanel.offers.paymentType")}
              </span>
              <select
                value={paymentType}
                onChange={(e) => {
                  const next = e.target.value as TeacherCoursePaymentType;
                  setPaymentType(next);
                  if (next === "free") setIsDefault(true);
                }}
                className={inputClass}
              >
                {paymentTypes.map((type) => (
                  <option key={type} value={type}>
                    {t(`creatorPanel.paymentType.${type}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-2 pt-6 text-sm text-[var(--color-ink)]">
            <input
              type="checkbox"
              checked={isDefault}
              disabled={paymentType === "free"}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            {t("creatorPanel.offers.isDefault")}
          </label>
          {mainPriceFirst && coursePricing && !loading ? (
            <p className="text-xs leading-5 text-[var(--color-ink-soft)] sm:col-span-2">
              {t("creatorPanel.offers.firstIsMain")
                .replace("{price}", () => money(coursePricing.amountMinor, coursePricing.currency))
                .replace("{model}", () => paymentTypeLabel(coursePricing.paymentType ?? "one_time"))}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={saving || loading}
              className="button-solid px-5 py-2.5 text-xs"
            >
              <BusyLabel
                busy={saving}
                idle={t("creatorPanel.offers.submit")}
                busyText={t("creatorPanel.offers.submitting")}
              />
            </button>
          </div>
        </form>
      ) : null}

      {/* Announced: creating a price and failing did not happen audibly. */}
      {error ? <InlineAlert tone="error" className="mt-3">{t(error)}</InlineAlert> : null}
      {/* "Created" looking created (the green check), not the gray of a hint. */}
      {notice ? (
        <p className="mt-3">
          <SavedNote text={t(notice)} />
        </p>
      ) : null}

    </section>
  );
}
