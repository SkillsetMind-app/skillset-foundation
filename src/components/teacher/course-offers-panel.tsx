"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { CourseShareLink } from "@/components/teacher/course-share-link";
import { CurrencySelect } from "@/components/teacher/currency-select";
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

const inputClass =
  "rounded-md border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]";

// O tipo de pagamento vem da API como texto livre. So os quatro conhecidos tem
// traducao; qualquer outro cai no formato antigo em vez de virar chave crua.
const KNOWN_PAYMENT_TYPES = new Set([
  "free",
  "one_time",
  "subscription_monthly",
  "subscription_yearly",
]);

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

// "Adicionar outro preco" fica dentro da forma de pagar escolhida em Preco,
// em vez de ser um segundo "Payment type" que podia contradizer a etapa de
// preco: pagamento unico ganha outro valor; mensalidade, outro mensal ou o
// plano anual; gratis nao tem outro preco. Sem o preco do curso (chamada
// antiga), as quatro formas continuam.
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
  /** Como o curso cobra hoje: e daqui que a primeira oferta nasce. */
  coursePricing?: CoursePricingShape;
  /** "Adicionar o plano anual" da etapa de preco: o formulario ja abre assim. */
  prefill?: { paymentType: TeacherCoursePaymentType; amountMinor: number } | null;
}) {
  const paymentTypes = paymentTypesFor(coursePricing);
  const startWith = prefill && paymentTypes.includes(prefill.paymentType) ? prefill : null;
  const { t } = useTranslation();
  // `t` fica fora das dependencias dos efeitos: com ele la, um provider que
  // devolva funcao nova por render reinscreve tudo em laco (a suite do CI
  // ficou muda 16 min). A ref le sempre o `t` atual sem reinscrever nada.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState(() =>
    t(
      startWith?.paymentType === "subscription_yearly"
        ? "creatorPanel.offers.yearlyName"
        : "creatorPanel.offers.defaultName",
    ),
  );
  // O formulario nascia com 97 USD avulso mesmo num curso gratuito ou por
  // assinatura: a tela pedia para confirmar um preco que nao era o do curso.
  // Semente unica, no primeiro render — reagir a cada mudanca do curso
  // apagaria o que a pessoa ja estivesse digitando.
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
  // O plano anual e um preco a mais: nao toma o lugar do mensal na pagina.
  const [isDefault, setIsDefault] = useState(!startWith);
  const [publicCode, setPublicCode] = useState("");
  // Com oferta na mesa, a tabela e o assunto; criar outra e uma acao, nao o
  // primeiro que a pessoa ve. Sem nenhuma, o formulario aberto guia melhor que
  // uma tabela vazia.
  const [creating, setCreating] = useState(Boolean(startWith));

  const paymentTypeLabel = (value: string) =>
    KNOWN_PAYMENT_TYPES.has(value)
      ? t(`creatorPanel.paymentType.${value}`)
      : value.replaceAll("_", " ");

  const hasOffers = !loading && offers.length > 0;
  const canAddPrice = paymentTypes.length > 0;
  // Sem nenhuma oferta o formulario segue aberto: vazio guiado bate tabela vazia.
  const formOpen = canAddPrice && (creating || (!loading && offers.length === 0));
  // Sem preco principal, o checkout usa o primeiro preco ativo daqui
  // (resolveCoursePrice). Quem adiciona um preco a mais precisa saber disso.
  const hasMainPrice = offers.some((offer) => offer.isDefault && offer.active);
  const mainPriceFirst = !isDefault && !hasMainPrice && coursePricing !== undefined && !coursePricing.free;

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
        throw new Error(data.error || tRef.current("creatorPanel.offers.loadError"));
      }
      setOffers(data.offers ?? []);
      if (data.warning) {
        setNotice(data.warning);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : tRef.current("creatorPanel.offers.loadError"),
      );
      setOffers([]);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    // Defer so the effect body itself does not synchronously setState (lint).
    // Renomeado de `t`: agora `t` e o tradutor do escopo de cima.
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
      setError(t("creatorPanel.offers.invalidAmount"));
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
        throw new Error(data.error || t("creatorPanel.offers.createError"));
      }
    };
    try {
      // Um preco a mais nunca entra sozinho: sem preco principal, o checkout
      // cobra o primeiro preco daqui (resolveCoursePrice) e o plano anual
      // virava o preco da pagina. O preco atual do produto vira o principal
      // antes; set_default_product_offer regrava o curso com os mesmos valores.
      if (mainPriceFirst && coursePricing?.paymentType) {
        await postOffer({
          name: courseTitle,
          amountMinor: coursePricing.amountMinor,
          currency: coursePricing.currency,
          paymentType: coursePricing.paymentType,
          isDefault: true,
        });
        // Se o segundo falhar, a lista ja tem o principal e tentar de novo
        // nao cria outro.
        await reload();
      }
      await postOffer({ name, amountMinor, currency, paymentType, isDefault, publicCode });
      setNotice(t("creatorPanel.offers.created"));
      setPublicCode("");
      setCreating(false);
      await reload();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t("creatorPanel.offers.createError"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="course-offers-title">
      <h2 id="course-offers-title" className="text-xl font-semibold text-[var(--color-ink)]">
        {t("creatorPanel.offers.title")}
      </h2>
      {/* Com oferta criada, o formulario empurrava a lista real para baixo:
          quem ja precificou vem aqui para conferir ou copiar link, nao para
          criar de novo. */}
      {/* "Sem outros precios" so e verdade sem nenhum na lista. */}
      {canAddPrice || loading || offers.length ? null : (
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

      {loading ? (
        <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
          {t("creatorPanel.offers.loading")}
        </p>
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
            {/* Era um campo de texto livre de três letras: aceitava "ABC", que o
                Stripe recusa só na hora de cobrar. O mesmo seletor do construtor,
                com exatamente a lista que o Stripe aceita. */}
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
              className="button-solid px-5 py-2.5 text-xs disabled:opacity-60"
            >
              {saving
                ? t("creatorPanel.offers.submitting")
                : t("creatorPanel.offers.submit")}
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-[var(--color-danger-fg)]">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">{notice}</p>
      ) : null}

    </section>
  );
}
