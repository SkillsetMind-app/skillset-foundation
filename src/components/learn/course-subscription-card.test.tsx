import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CourseSubscriptionCard } from "@/components/learn/course-subscription-card";
import type { CourseSubscription } from "@/domain/course-subscription";
import { subscribeToCourseSubscription } from "@/lib/data/course-subscriptions";
import { setCourseSubscriptionCancellation } from "@/lib/payments/course-subscription";

const mocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  router: { refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/data/course-subscriptions", () => ({ subscribeToCourseSubscription: vi.fn() }));
vi.mock("@/lib/payments/course-subscription", () => ({ setCourseSubscriptionCancellation: vi.fn() }));

const subscription: CourseSubscription = {
  id: "sub-literal-$&-{id}",
  userId: "learner-fixture",
  courseId: "course-literal-$&-{id}",
  stripeSubscriptionId: "sub-literal-$&-{id}",
  status: "active",
  interval: "month",
  currentPeriodEnd: "2026-08-15T12:00:00.000Z",
  cancelAtPeriodEnd: false,
  pastDue: false,
};

type SubscriptionCallback = Parameters<typeof subscribeToCourseSubscription>[1];
type SubscriptionErrorCallback = Parameters<typeof subscribeToCourseSubscription>[2];
type CancellationResult = Awaited<ReturnType<typeof setCourseSubscriptionCancellation>>;

let onSubscription: SubscriptionCallback | undefined;
let onReadError: SubscriptionErrorCallback | undefined;

const READ_DETAIL = "SYNTHETIC_READ_DETAIL_$&_{id}";
const ACTION_DETAIL = "SYNTHETIC_ACTION_DETAIL_$&_{id}";

function LanguageControls() {
  const { setLocale } = useTranslation();
  return <>
    <button type="button" onClick={() => setLocale("en")}>Use EN</button>
    <button type="button" onClick={() => setLocale("es")}>Use ES</button>
  </>;
}

function renderCard(locale: "en" | "es" = "en") {
  return render(<I18nProvider initialLocale={locale}>
    <LanguageControls />
    <section aria-label="Subscription fixture">
      <CourseSubscriptionCard courseId={subscription.courseId} subscriptionId={subscription.id} />
    </section>
  </I18nProvider>);
}

function card() {
  return screen.getByRole("region", { name: "Subscription fixture" });
}

function changeLanguage(locale: "en" | "es") {
  fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Use EN" : "Use ES" }));
}

function emit(next: CourseSubscription | null) {
  const callback = onSubscription;
  if (!callback) throw new Error("The card has not subscribed to the fixture.");
  act(() => callback(next));
}

function failRead() {
  const callback = onReadError;
  if (!callback) throw new Error("The card has not registered its read error callback.");
  act(() => callback(new Error(READ_DETAIL)));
}

function deferredCancellation() {
  let resolve!: (value: CancellationResult) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<CancellationResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function expectSingleSubscription() {
  expect(subscribeToCourseSubscription).toHaveBeenCalledExactlyOnceWith(
    subscription.id,
    expect.any(Function),
    expect.any(Function),
  );
  expect(mocks.unsubscribe).not.toHaveBeenCalled();
}

function expectNoFuturePromise() {
  // Buttons remain governed by the existing contract. These expressions target
  // claims in the status/date copy, not "Undo scheduled cancellation" itself.
  expect(card()).not.toHaveTextContent(
    /\bactive\b|\bactiva\b|\bactivo\b|\brenews\b|se renueva|\bcancels\b|se cancela\b|cancellation scheduled[.,]|cancelación programada[.,]|you keep access|conservas el acceso|mantienes el acceso|retrying|reintentando/i,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  onSubscription = undefined;
  onReadError = undefined;
  vi.mocked(subscribeToCourseSubscription).mockImplementation((_id, next, error) => {
    onSubscription = next;
    onReadError = error;
    return mocks.unsubscribe;
  });
});

afterEach(cleanup);

describe("CourseSubscriptionCard — idioma e estado recebido", () => {
  it.each([
    { interval: "month", label: "Acceso mensual" },
    { interval: "year", label: "Acceso anual" },
    { interval: null, label: "Acceso recurrente" },
  ] as const)("traduz a cadência $interval como frase completa e localiza a data", ({ interval, label }) => {
    renderCard("es");
    emit({ ...subscription, interval });

    expect(within(card()).getByText("Suscripción")).toBeVisible();
    expect(within(card()).getByRole("heading", { name: label })).toBeVisible();
    expect(card()).toHaveTextContent("15 ago 2026");
    expect(card()).not.toHaveTextContent(/Aug 15, 2026|Monthly access|Yearly access|Recurring access/);
    expect(within(card()).getByRole("button", { name: "Cancelar suscripción" })).toBeEnabled();
    expectSingleSubscription();
    expect(setCourseSubscriptionCancellation).not.toHaveBeenCalled();
  });

  it("troca EN↔ES mantendo dados literais, foco, inscrição e ausência de escrita", () => {
    const view = renderCard();
    const row = { ...subscription };
    const original = { ...row };
    emit(row);
    const cancel = within(card()).getByRole("button", { name: "Cancel subscription" });
    cancel.focus();

    changeLanguage("es");
    expect(within(card()).getByRole("heading", { name: "Acceso mensual" })).toBeVisible();
    expect(within(card()).getByRole("button", { name: "Cancelar suscripción" })).toBe(cancel);
    expect(cancel).toHaveFocus();
    expect(card()).toHaveTextContent("15 ago 2026");

    changeLanguage("en");
    expect(within(card()).getByRole("heading", { name: "Monthly access" })).toBeVisible();
    expect(within(card()).getByRole("button", { name: "Cancel subscription" })).toBe(cancel);
    expect(card()).toHaveTextContent("Aug 15, 2026");
    expect(row).toEqual(original);
    expectSingleSubscription();
    expect(setCourseSubscriptionCancellation).not.toHaveBeenCalled();
    expect(mocks.router.refresh).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("distingue loading de null legítimo e traduz ambos sem reiniciar a leitura", () => {
    renderCard("es");
    expect(within(card()).getByText("Cargando suscripción...")).toBeVisible();
    expect(within(card()).queryByText("Todavía no hay detalles de la suscripción.")).not.toBeInTheDocument();
    expect(within(card()).queryByRole("button")).not.toBeInTheDocument();

    changeLanguage("en");
    expect(within(card()).getByText("Loading subscription...")).toBeVisible();
    emit(null);
    expect(within(card()).getByText("No subscription details are available yet.")).toBeVisible();
    expect(within(card()).queryByText("Loading subscription...")).not.toBeInTheDocument();
    expect(within(card()).queryByRole("alert")).not.toBeInTheDocument();

    changeLanguage("es");
    expect(within(card()).getByText("Todavía no hay detalles de la suscripción.")).toBeVisible();
    expect(within(card()).queryByRole("button")).not.toBeInTheDocument();
    expectSingleSubscription();
    expect(setCourseSubscriptionCancellation).not.toHaveBeenCalled();
  });

  it("anuncia erro inicial, traduz o erro existente e só mostra vazio depois de null válido", () => {
    renderCard();
    failRead();
    expect(within(card()).getByRole("alert")).toBeVisible();
    expect(within(card()).getByRole("alert")).toHaveTextContent("We could not load your subscription details.");
    expect(card()).not.toHaveTextContent(/Loading subscription|No subscription details are available yet|appear here shortly/);

    changeLanguage("es");
    expect(within(card()).getByRole("alert")).toBeVisible();
    expect(within(card()).getByRole("alert")).toHaveTextContent("No pudimos cargar los detalles de tu suscripción.");
    expect(card()).not.toHaveTextContent(/We could not load|Todavía no hay detalles|aparecerán|SYNTHETIC_READ_DETAIL/);
    emit(null);
    expect(within(card()).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(card()).getByText("Todavía no hay detalles de la suscripción.")).toBeVisible();
    expectSingleSubscription();
    expect(setCourseSubscriptionCancellation).not.toHaveBeenCalled();
  });

  it.each(["active", "trialing"])("preserva a apresentação do ciclo de %s com e sem cancelamento agendado", (status) => {
    renderCard();
    emit({ ...subscription, status });
    expect(card()).toHaveTextContent(/renews Aug 15, 2026/i);
    expect(within(card()).getByRole("button", { name: "Cancel subscription" })).toBeEnabled();

    emit({ ...subscription, status, cancelAtPeriodEnd: true });
    expect(card()).toHaveTextContent(/cancellation scheduled[\s\S]*Aug 15, 2026/i);
    expect(within(card()).getByRole("button", { name: "Undo scheduled cancellation" })).toBeEnabled();
    changeLanguage("es");
    expect(card()).toHaveTextContent(/cancelación programada[\s\S]*15 ago 2026/i);
    expect(within(card()).getByRole("button", { name: "Deshacer cancelación programada" })).toBeEnabled();
    expect(card()).not.toHaveTextContent(/you keep access|Cancellation scheduled|Resume subscription/i);
    expectSingleSubscription();
    expect(setCourseSubscriptionCancellation).not.toHaveBeenCalled();
  });

  it.each(["canceled", "incomplete_expired", "paused", "incomplete", "future_contract"])(
    "%s mostra fim do período nas duas flags, sem transformar o estado em promessa futura",
    (status) => {
      renderCard();
      for (const cancelAtPeriodEnd of [false, true]) {
        // The true case also carries a stale payment flag. Final-state copy
        // must not turn that flag into a promise of collection or access.
        emit({ ...subscription, status, cancelAtPeriodEnd, pastDue: cancelAtPeriodEnd });
        expect(card()).toHaveTextContent("Period end Aug 15, 2026");
        expectNoFuturePromise();
        changeLanguage("es");
        expect(card()).toHaveTextContent("Fin del período 15 ago 2026");
        expectNoFuturePromise();
        expect(card()).not.toHaveTextContent(/learn\.classroom\.|teach\.subscriptions\./);
        changeLanguage("en");
      }
      expectSingleSubscription();
      expect(setCourseSubscriptionCancellation).not.toHaveBeenCalled();
    },
  );

  it.each([null, "invalid-fixture-date"])("data final %s não inventa um término ou uma renovação", (currentPeriodEnd) => {
    renderCard();
    emit({ ...subscription, status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd });
    expect(card()).toHaveTextContent("Period end Date pending");
    expectNoFuturePromise();
    changeLanguage("es");
    expect(card()).toHaveTextContent("Fin del período Fecha pendiente");
    expect(card()).not.toHaveTextContent(/Invalid Date|NaN|1970|Aug 15, 2026|15 ago 2026/);
    expectNoFuturePromise();
    expectSingleSubscription();
    expect(setCourseSubscriptionCancellation).not.toHaveBeenCalled();
  });

  it.each(["past_due", "unpaid"])("%s informa atenção ao pagamento sem garantir nova tentativa de cobrança", (status) => {
    renderCard();
    for (const cancelAtPeriodEnd of [false, true]) {
      emit({ ...subscription, status, cancelAtPeriodEnd, pastDue: status === "unpaid" });
      expect(card()).toHaveTextContent("Payment needs attention. Review your payment details.");
      expect(card()).toHaveTextContent("Period end Aug 15, 2026");
      expectNoFuturePromise();
      changeLanguage("es");
      expect(card()).toHaveTextContent("El pago necesita atención. Revisa tus datos de pago.");
      expect(card()).toHaveTextContent("Fin del período 15 ago 2026");
      expectNoFuturePromise();
      changeLanguage("en");
    }
    expectSingleSubscription();
    expect(setCourseSubscriptionCancellation).not.toHaveBeenCalled();
  });
});

const actions = [
  {
    resume: false,
    english: "Cancel subscription",
    spanish: "Cancelar suscripción",
    englishError: "We could not cancel your subscription. Please try again.",
    spanishError: "No pudimos cancelar tu suscripción. Inténtalo de nuevo.",
  },
  {
    resume: true,
    english: "Undo scheduled cancellation",
    spanish: "Deshacer cancelación programada",
    englishError: "We could not undo the scheduled cancellation. Please try again.",
    spanishError: "No pudimos deshacer la cancelación programada. Inténtalo de nuevo.",
  },
] as const;

describe("CourseSubscriptionCard — contrato de ação preservado", () => {
  it.each([false, true])("controle EN: encaminha resume=%s uma vez e aguarda o stream", async (resume) => {
    const pending = deferredCancellation();
    vi.mocked(setCourseSubscriptionCancellation).mockReturnValue(pending.promise);
    const view = renderCard();
    emit({ ...subscription, cancelAtPeriodEnd: resume });
    expect(within(card()).getByRole("heading", { name: "Monthly access" })).toBeVisible();
    expect(card()).toHaveTextContent("Aug 15, 2026");
    const initialButton = within(card()).getByRole("button");
    const initialLabel = initialButton.textContent;
    fireEvent.click(initialButton);
    const working = within(card()).getByRole("button", { name: "Working..." });
    expect(working).toBeDisabled();
    fireEvent.click(working);
    expect(setCourseSubscriptionCancellation).toHaveBeenCalledExactlyOnceWith(subscription.courseId, resume);

    await act(async () => pending.resolve({
      cancelAtPeriodEnd: !resume,
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
      status: "active",
    }));
    expect(within(card()).getByRole("button").textContent).toBe(initialLabel);
    expect(within(card()).getByRole("button")).toBeEnabled();
    emit({ ...subscription, cancelAtPeriodEnd: !resume });
    expect(within(card()).getByRole("button").textContent).not.toBe(initialLabel);
    expect(within(card()).queryByRole("alert")).not.toBeInTheDocument();
    expectSingleSubscription();
    expect(setCourseSubscriptionCancellation).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each(actions)("$english conserva payload/pending e apresenta a falha no idioma atual", async (action) => {
    const pending = deferredCancellation();
    vi.mocked(setCourseSubscriptionCancellation).mockReturnValue(pending.promise);
    renderCard();
    const row = { ...subscription, cancelAtPeriodEnd: action.resume };
    const original = { ...row };
    emit(row);
    fireEvent.click(within(card()).getByRole("button", { name: action.english }));
    expect(within(card()).getByRole("button", { name: "Working..." })).toBeDisabled();

    changeLanguage("es");
    const working = within(card()).getByRole("button", { name: "Procesando..." });
    expect(working).toBeDisabled();
    fireEvent.click(working);
    expect(setCourseSubscriptionCancellation).toHaveBeenCalledExactlyOnceWith(subscription.courseId, action.resume);
    expectSingleSubscription();

    await act(async () => pending.reject(new Error(ACTION_DETAIL)));
    expect(within(card()).getByRole("button", { name: action.spanish })).toBeEnabled();
    expect(within(card()).getByRole("alert")).toBeVisible();
    expect(within(card()).getByRole("alert")).toHaveTextContent(action.spanishError);
    expect(card()).not.toHaveTextContent(ACTION_DETAIL);
    expect(card()).not.toHaveTextContent(action.englishError);
    changeLanguage("en");
    expect(within(card()).getByRole("alert")).toHaveTextContent(action.englishError);
    expect(within(card()).getByRole("button", { name: action.english })).toBeEnabled();
    expect(row).toEqual(original);
    expectSingleSubscription();
    expect(setCourseSubscriptionCancellation).toHaveBeenCalledTimes(1);
  });

  it.each(actions)("$english aguarda o stream para trocar a flag ou o status após sucesso", async (action) => {
    const pending = deferredCancellation();
    vi.mocked(setCourseSubscriptionCancellation).mockReturnValue(pending.promise);
    renderCard();
    const row = { ...subscription, status: "past_due", pastDue: false, cancelAtPeriodEnd: action.resume };
    const original = { ...row };
    emit(row);
    fireEvent.click(within(card()).getByRole("button", { name: action.english }));
    changeLanguage("es");
    expect(within(card()).getByRole("button", { name: "Procesando..." })).toBeDisabled();

    // Deliberately different from the mirror: this is a UI boundary test, not
    // a claim that Stripe accepts or produces this transition for past_due.
    await act(async () => pending.resolve({
      cancelAtPeriodEnd: !action.resume,
      currentPeriodEnd: "2030-01-01T12:00:00.000Z",
      status: "active",
    }));
    expect(within(card()).getByRole("button", { name: action.spanish })).toBeEnabled();
    expect(card()).toHaveTextContent("El pago necesita atención. Revisa tus datos de pago.");
    expect(card()).toHaveTextContent("Fin del período 15 ago 2026");
    expect(card()).not.toHaveTextContent("2030");
    expectNoFuturePromise();

    emit({ ...row, cancelAtPeriodEnd: !action.resume });
    expect(within(card()).getByRole("button", {
      name: action.resume ? "Cancelar suscripción" : "Deshacer cancelación programada",
    })).toBeEnabled();
    expect(card()).toHaveTextContent("El pago necesita atención. Revisa tus datos de pago.");
    expect(row).toEqual(original);
    expectSingleSubscription();
    expect(setCourseSubscriptionCancellation).toHaveBeenCalledExactlyOnceWith(subscription.courseId, action.resume);
  });

  it("a recuperação da leitura limpa somente seu erro e preserva a falha independente da ação", async () => {
    const pending = deferredCancellation();
    vi.mocked(setCourseSubscriptionCancellation).mockReturnValue(pending.promise);
    renderCard();
    emit({ ...subscription });
    fireEvent.click(within(card()).getByRole("button", { name: "Cancel subscription" }));
    await act(async () => pending.reject(new Error(ACTION_DETAIL)));
    expect(within(card()).getByText("We could not cancel your subscription. Please try again.")).toBeVisible();

    failRead();
    expect(within(card()).getByText("We could not load your subscription details.")).toBeVisible();
    expect(within(card()).getByText("We could not cancel your subscription. Please try again.")).toBeVisible();
    emit({ ...subscription });
    expect(within(card()).queryByText("We could not load your subscription details.")).not.toBeInTheDocument();
    expect(within(card()).getByRole("alert")).toHaveTextContent("We could not cancel your subscription. Please try again.");

    changeLanguage("es");
    expect(within(card()).getByRole("alert")).toHaveTextContent("No pudimos cancelar tu suscripción. Inténtalo de nuevo.");
    expect(card()).not.toHaveTextContent(/No pudimos cargar|SYNTHETIC_READ_DETAIL|SYNTHETIC_ACTION_DETAIL/);
    expect(within(card()).getByRole("button", { name: "Cancelar suscripción" })).toBeEnabled();
    expectSingleSubscription();
    expect(setCourseSubscriptionCancellation).toHaveBeenCalledExactlyOnceWith(subscription.courseId, false);
  });
});
