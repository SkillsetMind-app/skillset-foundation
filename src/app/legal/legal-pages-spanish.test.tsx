import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PrivacyPage, { generateMetadata as privacyMetadata } from "./privacy/page";
import TermsPage, { generateMetadata as termsMetadata } from "./terms/page";
import TeacherTermsPage, { generateMetadata as teacherMetadata } from "./teacher-terms/page";
import CopyrightPage, { generateMetadata as copyrightMetadata } from "./copyright/page";
import RefundPolicyPage, { generateMetadata as refundMetadata } from "@/app/refund-policy/page";
import { LegalText } from "@/components/site/legal-article";
import { helpFaqCategories } from "@/data/help-faq";
import { activationFeeUsd, refundWindowDays } from "@/data/plans";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { currentPrivacyVersion, currentTeacherTermsVersion, currentTermsVersion } from "@/lib/legal/versions";
import { automaticRefundProgressCap } from "@/lib/payments/rules";
import englishReference from "./legal-english-reference.test.json";

const request = vi.hoisted(() => ({ locale: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === LOCALE_COOKIE && request.locale !== undefined
      ? { value: request.locale }
      : undefined,
  }),
}));
// Only peripheral site chrome is omitted. Pages, translations and the legal frame are real.
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));
afterEach(() => { cleanup(); request.locale = undefined; });

const pages = [
  { key: "privacy", Page: PrivacyPage, metadata: privacyMetadata, path: "/legal/privacy", sections: 12, texts: 44, title: "Política de privacidad" },
  { key: "terms", Page: TermsPage, metadata: termsMetadata, path: "/legal/terms", sections: 18, texts: 37, title: "Condiciones de servicio" },
  { key: "teacherTerms", Page: TeacherTermsPage, metadata: teacherMetadata, path: "/legal/teacher-terms", sections: 13, texts: 31, title: "Condiciones para educadores" },
  { key: "copyright", Page: CopyrightPage, metadata: copyrightMetadata, path: "/legal/copyright", sections: 5, texts: 19, title: "Política de derechos de autor (DMCA)" },
  { key: "refund", Page: RefundPolicyPage, metadata: refundMetadata, path: "/refund-policy", sections: 7, texts: 10, title: "Política de reembolsos y devoluciones" },
] as const;

function legalDictionary(locale: Locale) {
  const legal = Reflect.get(getDictionary(locale), "legalPages") as typeof englishReference | undefined;
  // Do not inject the private merge fragment: missing integration must fail this test.
  expect(legal, `legalPages must be shipped in the real ${locale} dictionary`).toBeDefined();
  return legal!;
}

function interpolate(value: string) {
  return value
    .replaceAll("{days}", () => String(refundWindowDays))
    .replaceAll("{amount}", () => String(activationFeeUsd));
}

function plain(value: string) {
  return interpolate(value).replace(/<\/?[a-zA-Z]+>/g, "").replace(/\s+/g, " ").trim();
}

const destinations = {
  terms: "/legal/terms", privacy: "/legal/privacy", teacherTerms: "/legal/teacher-terms",
  copyright: "/legal/copyright", promise: "/promise", pricing: "/pricing", account: "/account",
  support: "mailto:support@skillsetmind.com", legal: "mailto:legal@skillsetmind.com",
};

describe("legal document translation from the request cookie", () => {
  it.each(pages)("$key keeps every block, section, emphasis, link and metadata in EN and ES", async ({ key, Page, metadata, path, sections, texts, title }) => {
    for (const locale of ["en", "es"] as const) {
      request.locale = locale;
      const dictionary = legalDictionary(locale);
      const document = dictionary[key] as Record<string, string>;
      const blocks = Array.from({ length: texts }, (_, index) => document[`text${index + 1}`]);
      const view = render(await Page());
      const main = screen.getByRole("main");
      const effective = dictionary.common.effectiveLabel.replace("{date}", () => dictionary.common.effectiveDate);

      expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(locale === "es" ? title : englishReference[key].title);
      expect(within(main).getByRole("heading", { level: 1 })).toHaveClass("page-title");
      expect(main.className).toContain("max-w-[72ch]");
      expect(within(main).getAllByRole("heading", { level: 2 }).map((node) => node.textContent)).toEqual(
        Array.from({ length: sections }, (_, index) => interpolate(document[`heading${index + 1}`])),
      );
      expect(Array.from(main.querySelectorAll("p, li, h3"), (node) => node.textContent?.replace(/\s+/g, " ").trim())).toEqual(
        [dictionary.common.kicker, ...blocks.slice(0, 2).map(plain), effective, ...blocks.slice(2).map(plain)],
      );
      const links = blocks.flatMap((block) => [...block.matchAll(/<(terms|privacy|teacherTerms|copyright|promise|pricing|account|support|legal)>([^<>]*)<\/\1>/g)]);
      expect(within(main).getAllByRole("link").map((node) => [node.getAttribute("href"), node.textContent])).toEqual(
        links.map(([, tag, label]) => [destinations[tag as keyof typeof destinations], label]),
      );
      for (const tag of ["strong", "em"]) {
        const contents = blocks.flatMap((block) => [...interpolate(block).matchAll(new RegExp(`<${tag}>([^<>]*)</${tag}>`, "g"))].map((match) => match[1]));
        expect(Array.from(main.querySelectorAll(tag), (node) => node.textContent)).toEqual(contents);
      }
      expect(main.textContent).not.toMatch(/legalPages\.|\{days\}|\{amount\}|\{date\}|<\/?(?:strong|em|terms|support|legal|account|privacy|teacherTerms|copyright|pricing|promise)>/);
      expect(main.querySelector("p p")).toBeNull();
      const meta = await metadata();
      expect(meta.title).toContain(document.title);
      expect(meta.description).toBe(interpolate(document.description));
      expect(meta.alternates?.canonical).toBe(`https://www.skillsetmind.com${path}`);
      view.unmount();
    }
  });

  it.each(pages)("$key defaults to English for absent or unsupported cookies", async ({ Page, key }) => {
    for (const cookie of [undefined, "pt-BR", "invalid"]) {
      request.locale = cookie;
      const view = render(await Page());
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(englishReference[key].title);
      expect(screen.getByText("Effective September 16, 2026")).toBeInTheDocument();
      view.unmount();
    }
  });

  it("keeps the reviewed English reference and matching ES keys, numbers and rich-text tags", () => {
    // Fixture extracted from the four English pages at 6cd334e; only JSX whitespace,
    // entities and inline nodes were normalized. Provider disclosures were updated explicitly.
    const en = legalDictionary("en");
    const es = legalDictionary("es");
    expect(en).toEqual(englishReference);
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const group of Object.keys(en) as Array<keyof typeof en>) {
      expect(Object.keys(es[group]).sort()).toEqual(Object.keys(en[group]).sort());
      for (const [key, value] of Object.entries(en[group])) {
        const translated = (es[group] as Record<string, string>)[key];
        expect(translated, `${group}.${key}`).toBeTruthy();
        if (!(group === "common" && key === "kicker") && !(group === "privacy" && key === "text40")) {
          expect(translated, `${group}.${key}: left in English`).not.toBe(value);
        }
        expect(translated.match(/\d+/g), `${group}.${key}: numbers`).toEqual(value.match(/\d+/g));
        expect(translated.match(/\{\w+\}|<\/?\w+>/g), `${group}.${key}: tags and variables`).toEqual(value.match(/\{\w+\}|<\/?\w+>/g));
        expect(translated).not.toMatch(/<[^>]+\s[^>]*>|<\/?(?:script|iframe|img|Link|a)\b/);
      }
    }
    expect(es.common.effectiveDate).toBe("16 de septiembre de 2026");
  });

  it.each(["en", "es"] as const)("discloses provider data and conditional use in %s, without promising prompt redaction", async (locale) => {
    request.locale = locale;
    render(await PrivacyPage());
    const section = screen.getByRole("heading", { name: legalDictionary(locale).privacy.heading5 }).parentElement!;
    const items = within(section).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector("strong")?.textContent)).toEqual([
      "Supabase", "Stripe", "Vercel", "PostHog", "Moonshot AI", "OpenAI", "Bunny.net", "Cloudflare Turnstile",
    ]);
    const provider = (name: string) => items.find((item) => item.querySelector("strong")?.textContent === name)!;
    expect(provider("Supabase")).toHaveTextContent(locale === "en" ? "advisor conversation history" : "historial de conversaciones del Asesor");
    expect(provider("Moonshot AI")).toHaveTextContent(locale === "en" ? "including drafts" : "incluidos los borradores");
    expect(provider("Moonshot AI")).toHaveTextContent(locale === "en" ? "without automatic removal of personal information" : "sin eliminar automáticamente la información personal");
    expect(provider("Moonshot AI")).not.toHaveTextContent(locale === "en" ? "does not add learners' personal data" : "no añade datos personales de estudiantes");
    expect(provider("OpenAI")).toHaveTextContent(locale === "en" ? "when knowledge search is configured" : "cuando la búsqueda de conocimiento está configurada");
    expect(provider("OpenAI")).toHaveTextContent(locale === "en" ? "even if the advisor later fails to reply" : "aunque el Asesor no logre responder después");
    expect(provider("Bunny.net")).toHaveTextContent(locale === "en" ? "uploaded video files and titles" : "archivos de video subidos y sus títulos");
    expect(provider("Cloudflare Turnstile")).toHaveTextContent(locale === "en" ? "when enabled" : "cuando está habilitado");
    expect(provider("Cloudflare Turnstile")).toHaveTextContent(locale === "en" ? "IP address" : "dirección IP");
  });

  it("retains English precedence and local-law exceptions in rendered Spanish", async () => {
    request.locale = "es";
    for (const Page of [PrivacyPage, TermsPage]) {
      const view = render(await Page());
      expect(screen.getByRole("main")).toHaveTextContent("prevalece la versión en inglés salvo que la legislación local exija lo contrario");
      view.unmount();
    }
    render(await TeacherTermsPage());
    expect(screen.getByRole("main")).toHaveTextContent("estas condiciones prevalecen para tu actividad como educador");
  });

  it.each(["en", "es"] as const)("does not promise US-only processing or unverified transfer safeguards in %s", async (locale) => {
    request.locale = locale;
    render(await PrivacyPage());
    const transfers = screen.getByRole("heading", { name: legalDictionary(locale).privacy.heading6 }).parentElement!;
    expect(transfers).toHaveTextContent(locale === "en"
      ? "the United States and in other countries where they operate"
      : "Estados Unidos y en otros países donde operan");
    expect(transfers.textContent).not.toMatch(/Standard Contractual Clauses|Cláusulas Contractuales Tipo|Data Privacy Framework|Marco de Privacidad de Datos|Data processing agreements|acuerdos de tratamiento de datos/);
  });

  it("does not broaden refund eligibility, waive Stripe timing or change the liability cap", async () => {
    request.locale = "es";
    let view = render(await RefundPolicyPage());
    expect(screen.getByRole("main")).toHaveTextContent("el 50% o más, lo que ocurra primero");
    expect(screen.getByRole("main")).toHaveTextContent("una vez por curso");
    expect(screen.getByRole("main")).toHaveTextContent("siempre que la compra siga cumpliendo las condiciones de la Sección 1");
    expect(screen.getByRole("main")).toHaveTextContent("salvo cuando la ley lo exija");
    view.unmount();
    view = render(await TeacherTermsPage());
    expect(screen.getByRole("main")).toHaveTextContent("normalmente de 7 a 14 días, y más en algunos países; el calendario lo fija Stripe");
    expect(screen.getByRole("main")).toHaveTextContent("SkillsetMind no puede dispensar");
    expect(screen.getByRole("main")).toHaveTextContent("no retiran automáticamente un curso de la publicación");
    view.unmount();
    render(await TermsPage());
    expect(screen.getByRole("main")).toHaveTextContent("se limita al mayor de los siguientes importes");
    expect(screen.getByRole("main")).toHaveTextContent("doce meses");
    expect(screen.getByRole("main")).toHaveTextContent("USD 100");
    expect(screen.getByRole("main")).toHaveTextContent("No son psicoterapia");
    expect(screen.getByRole("main")).toHaveTextContent("esta sección no afecta a esos derechos");
  });

  it("never describes Brazil as a payout country before it is supported", () => {
    // Payouts cover the US, CA, GB, CH, the EU, LI and NO; Latin America and Brazil come later.
    const brazilPayout = /days in Brazil|d[ií]as en Brasil|Brazil included|incluido Brasil, ese/;
    for (const locale of ["en", "es"] as const) {
      expect(JSON.stringify(getDictionary(locale))).not.toMatch(brazilPayout);
    }
    expect(JSON.stringify(helpFaqCategories)).not.toMatch(brazilPayout);
  });

  it("shows the effective date that the stored legal versions record", () => {
    for (const version of [currentTermsVersion, currentPrivacyVersion, currentTeacherTermsVersion]) {
      for (const locale of ["en", "es"] as const) {
        const formatted = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es", { dateStyle: "long", timeZone: "UTC" })
          .format(new Date(`${version}T00:00:00Z`));
        expect(formatted, `${locale} ${version}`).toBe(legalDictionary(locale).common.effectiveDate);
      }
    }
  });

  it.each(["en", "es"] as const)("states the product's refund rule in the %s Terms", async (locale) => {
    request.locale = locale;
    render(await TermsPage());
    const refunds = screen.getByRole("heading", { name: legalDictionary(locale).terms.heading7 }).parentElement!;
    expect(refunds).toHaveTextContent(`${refundWindowDays}`);
    expect(refunds).toHaveTextContent(`${automaticRefundProgressCap}%`);
    expect(refunds).toHaveTextContent(locale === "en" ? "once per course" : "una vez por curso");
    expect(refunds.textContent).not.toMatch(/substantially completed|completado sustancialmente/);
  });

  it.each(["en", "es"] as const)("names SKILLSET USA INC. and routes %s copyright notices to legal@ and the DMCA page", async (locale) => {
    request.locale = locale;
    let view = render(await TermsPage());
    const ip = screen.getByRole("heading", { name: legalDictionary(locale).terms.heading11 }).parentElement!;
    expect(within(ip).getByRole("link", { name: locale === "en" ? "Copyright (DMCA) Policy" : "Política de derechos de autor (DMCA)" })).toHaveAttribute("href", "/legal/copyright");
    expect(within(ip).getByRole("link", { name: "legal@skillsetmind.com" })).toHaveAttribute("href", "mailto:legal@skillsetmind.com");
    expect(screen.getByRole("main")).toHaveTextContent("SKILLSET USA INC.");
    expect(screen.getByRole("main").textContent).not.toMatch(/Skillset USA/);
    view.unmount();
    view = render(await PrivacyPage());
    expect(screen.getByRole("main")).toHaveTextContent("SKILLSET USA INC.");
    expect(screen.getByRole("main").textContent).not.toMatch(/Skillset USA/);
    view.unmount();
  });

  it.each(["en", "es"] as const)("gives the %s legal address from the NY DOS filing and IRS CP575A", async (locale) => {
    // Confirmed 2026-09-15 against the NY DOS filing receipt and the IRS CP575A letter.
    request.locale = locale;
    const country = locale === "en" ? "United States" : "Estados Unidos";
    for (const Page of [TermsPage, PrivacyPage]) {
      const view = render(await Page());
      const main = screen.getByRole("main");
      expect(main).toHaveTextContent(`SKILLSET USA INC., 418 Broadway, Ste N, Albany, NY 12207, ${country}`);
      expect(main.textContent).not.toMatch(/26 Broadway|10006/);
      view.unmount();
    }
  });

  it.each(["en", "es"] as const)("publishes the %s DMCA notice, counter-notice and repeat-infringer rules without an EIN", async (locale) => {
    request.locale = locale;
    render(await CopyrightPage());
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent("§512(c)(3)");
    expect(main).toHaveTextContent("§512(g)(3)");
    expect(main).toHaveTextContent("SKILLSET USA INC.");
    expect(main).toHaveTextContent(locale === "en"
      ? "registration with the U.S. Copyright Office is in progress"
      : "(U.S. Copyright Office) está en trámite");
    expect(main).toHaveTextContent(locale === "en" ? "repeat infringers" : "de forma reiterada");
    expect(within(main).getAllByRole("link", { name: "legal@skillsetmind.com" })[0]).toHaveAttribute("href", "mailto:legal@skillsetmind.com");
    expect(main.textContent).not.toMatch(/\b\d{2}-\d{7}\b|\bEIN\b/);
  });

  it.each(["en", "es"] as const)("tells %s teachers the activation fee, eligibility and who carries refunds and disputes", async (locale) => {
    request.locale = locale;
    render(await TeacherTermsPage());
    const doc = legalDictionary(locale).teacherTerms as Record<string, string>;
    const section = (n: number) => screen.getByRole("heading", { name: doc[`heading${n}`] }).parentElement!;
    expect(section(2)).toHaveTextContent(locale === "en"
      ? "the United States, Canada, the United Kingdom, Switzerland, the European Union, Liechtenstein and Norway. Latin America, including Brazil, is planned for later."
      : "Estados Unidos, Canadá, el Reino Unido, Suiza, la Unión Europea, Liechtenstein y Noruega. América Latina, incluido Brasil, está prevista más adelante.");
    // CONNECT_PAYOUT_COUNTRIES leaves Iceland out (recipient-only), so no "EEA".
    expect(section(2).textContent).not.toMatch(/Economic Area|Espacio Económico|Iceland|Islandia/);
    expect(section(7)).toHaveTextContent(locale === "en" ? "not returned when a sale is lost to a dispute" : "no se devuelve cuando una venta se pierde en una disputa");
    expect(section(7)).toHaveTextContent(locale === "en" ? "may debit your bank account" : "cargar el importe en tu cuenta bancaria");
    expect(section(8)).toHaveTextContent(`US$${activationFeeUsd}`);
    expect(section(8)).toHaveTextContent(locale === "en" ? "within 7 days of payment" : "dentro de los 7 días siguientes al pago");
    expect(section(8)).toHaveTextContent(locale === "en" ? "does not refund the fee you paid" : "no da derecho al reembolso");
  });
});

it("renders only allowlisted inline nodes and leaves arbitrary HTML inert", () => {
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(1)><account href="javascript:alert(1)">unsafe</account><strong>mismatch</em>';
  const { container } = render(<LegalText text={`${hostile}<strong>Bold $&</strong><em>Emphasis</em><account>Billing</account><support>support@skillsetmind.com</support>`} />);
  expect(container.textContent).toContain(hostile);
  expect(container.querySelector("script, img, iframe, [onerror]")).toBeNull();
  expect(container.querySelector("strong")).toHaveTextContent("Bold $&");
  expect(container.querySelector("em")).toHaveTextContent("Emphasis");
  expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute("href", "/account");
  expect(screen.getByRole("link", { name: "support@skillsetmind.com" })).toHaveAttribute("href", "mailto:support@skillsetmind.com");
});
