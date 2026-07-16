"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { PanelCard } from "@/components/teacher/course-commerce-panels";
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

const inputClass =
  "rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]";

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

/**
 * Hotmart-style multi-offer list for a course.
 * Creates offer+price packages consumed by dual-read checkout.
 */
export function CourseOffersPanel({
  courseId,
  defaultCurrency = "USD",
}: {
  courseId: string;
  defaultCurrency?: string;
}) {
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("Standard offer");
  const [amount, setAmount] = useState("97");
  const [currency, setCurrency] = useState(defaultCurrency || "USD");
  const [paymentType, setPaymentType] =
    useState<TeacherCoursePaymentType>("one_time");
  const [isDefault, setIsDefault] = useState(true);
  const [publicCode, setPublicCode] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/teach/offers?courseId=${encodeURIComponent(courseId)}`,
        { credentials: "include" },
      );
      const data = (await res.json()) as { offers?: OfferRow[]; error?: string; warning?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not load offers.");
      }
      setOffers(data.offers ?? []);
      if (data.warning) {
        setNotice(data.warning);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load offers.",
      );
      setOffers([]);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    // Defer so the effect body itself does not synchronously setState (lint).
    const t = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => window.clearTimeout(t);
  }, [reload]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const amountMinor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor < 0) {
      setError("Enter a valid price.");
      setSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/teach/offers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          name,
          amountMinor,
          currency,
          paymentType,
          isDefault,
          publicCode,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not create offer.");
      }
      setNotice("Offer created. Its buyer link now resolves this exact price.");
      setPublicCode("");
      await reload();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create offer.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelCard
      title="Offers & prices"
      description="Create one-time or subscription packages. The default drives the main page; every active offer has an exact buyer link."
    >
      <form onSubmit={(e) => void handleCreate(e)} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
            Offer name
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
            Public code (optional)
          </span>
          <input
            value={publicCode}
            onChange={(e) =>
              setPublicCode(
                e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24),
              )
            }
            placeholder="e.g. LAUNCH"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
            Amount
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
            Currency
          </span>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            className={inputClass}
            required
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
            Payment type
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
            <option value="one_time">One-time</option>
            <option value="subscription_monthly">Subscription monthly</option>
            <option value="subscription_yearly">Subscription yearly</option>
            <option value="free">Free</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm text-[var(--color-ink)]">
          <input
            type="checkbox"
            checked={isDefault}
            disabled={paymentType === "free"}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Default offer (drives checkout + syncs legacy price)
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="button-solid px-5 py-2.5 text-xs disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create offer"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">{notice}</p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-[var(--color-ink-soft)]">Loading offers…</p>
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
                      default
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  {price
                    ? `${money(price.amountMinor, price.currency)} · ${price.paymentType.replaceAll("_", " ")}`
                    : "No price"}
                  {offer.publicCode ? ` · code ${offer.publicCode}` : ""}
                  {offer.active ? "" : " · inactive"}
                </p>
                {offer.active && price ? (
                  <a
                    href={`/courses/${encodeURIComponent(courseId)}?${
                      offer.publicCode
                        ? `offer=${encodeURIComponent(offer.publicCode)}`
                        : `offerId=${encodeURIComponent(offer.id)}`
                    }`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-2 inline-flex text-xs font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
                  >
                    Open buyer link
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
          No offers yet — checkout uses the legacy course price until you create one.
        </p>
      )}
    </PanelCard>
  );
}
