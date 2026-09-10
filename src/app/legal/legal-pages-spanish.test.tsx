import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PrivacyPage, { generateMetadata as privacyMetadata } from "./privacy/page";
import TermsPage, { generateMetadata as termsMetadata } from "./terms/page";
import TeacherTermsPage, { generateMetadata as teacherMetadata } from "./teacher-terms/page";
import RefundPolicyPage, { generateMetadata as refundMetadata } from "@/app/refund-policy/page";
import { LegalText } from "@/components/site/legal-article";
import { refundWindowDays } from "@/data/plans";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
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
  { key: "privacy", Page: PrivacyPage, metadata: privacyMetadata, path: "/legal/privacy", sections: 12, texts: 40, title: "Política de privacidad" },
  { key: "terms", Page: TermsPage, metadata: termsMetadata, path: "/legal/terms", sections: 18, texts: 37, title: "Condiciones de servicio" },
  { key: "teacherTerms", Page: TeacherTermsPage, metadata: teacherMetadata, path: "/legal/teacher-terms", sections: 12, texts: 26, title: "Condiciones para educadores" },
  { key: "refund", Page: RefundPolicyPage, metadata: refundMetadata, path: "/refund-policy", sections: 7, texts: 10, title: "Política de reembolsos y devoluciones" },
] as const;

function legalDictionary(locale: Locale) {
  const legal = Reflect.get(getDictionary(locale), "legalPages") as typeof englishReference | undefined;
  // Do not inject the private merge fragment: missing integration must fail this test.
  expect(legal, `legalPages must be shipped in the real ${locale} dictionary`).toBeDefined();
  return legal!;
}

function interpolate(value: string) {
  return value.replaceAll("{days}", () => String(refundWindowDays));
}

function plain(value: string) {
  return interpolate(value).replace(/<\/?[a-zA-Z]+>/g, "").replace(/\s+/g, " ").trim();
}

const destinations = {
  terms: "/legal/terms", privacy: "/legal/privacy", teacherTerms: "/legal/teacher-terms",
  promise: "/promise", pricing: "/pricing", account: "/account",
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
      const links = blocks.flatMap((block) => [...block.matchAll(/<(terms|privacy|teacherTerms|promise|pricing|account|support|legal)>([^<>]*)<\/\1>/g)]);
      expect(within(main).getAllByRole("link").map((node) => [node.getAttribute("href"), node.textContent])).toEqual(
        links.map(([, tag, label]) => [destinations[tag as keyof typeof destinations], label]),
      );
      for (const tag of ["strong", "em"]) {
        const contents = blocks.flatMap((block) => [...interpolate(block).matchAll(new RegExp(`<${tag}>([^<>]*)</${tag}>`, "g"))].map((match) => match[1]));
        expect(Array.from(main.querySelectorAll(tag), (node) => node.textContent)).toEqual(contents);
      }
      expect(main.textContent).not.toMatch(/legalPages\.|\{days\}|\{date\}|<\/?(?:strong|em|terms|support|legal|account|privacy|teacherTerms|pricing|promise)>/);
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
      expect(screen.getByText("Effective July 5, 2026")).toBeInTheDocument();
      view.unmount();
    }
  });

  it("keeps the 6cd334e English reference and matching ES keys, numbers and rich-text tags", () => {
    // Fixture extracted from the four English pages at 6cd334e; only JSX whitespace,
    // entities and inline link/formatting nodes were normalized. No legal copy was rewritten.
    const en = legalDictionary("en");
    const es = legalDictionary("es");
    expect(en).toEqual(englishReference);
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const group of Object.keys(en) as Array<keyof typeof en>) {
      expect(Object.keys(es[group]).sort()).toEqual(Object.keys(en[group]).sort());
      for (const [key, value] of Object.entries(en[group])) {
        const translated = (es[group] as Record<string, string>)[key];
        expect(translated, `${group}.${key}`).toBeTruthy();
        if (!(group === "common" && key === "kicker") && !(group === "privacy" && key === "text36")) {
          expect(translated, `${group}.${key}: left in English`).not.toBe(value);
        }
        expect(translated.match(/\d+/g), `${group}.${key}: numbers`).toEqual(value.match(/\d+/g));
        expect(translated.match(/\{\w+\}|<\/?\w+>/g), `${group}.${key}: tags and variables`).toEqual(value.match(/\{\w+\}|<\/?\w+>/g));
        expect(translated).not.toMatch(/<[^>]+\s[^>]*>|<\/?(?:script|iframe|img|Link|a)\b/);
      }
    }
    expect(es.common.effectiveDate).toBe("5 de julio de 2026");
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

  it("does not broaden refund eligibility, waive Stripe timing or change the liability cap", async () => {
    request.locale = "es";
    let view = render(await RefundPolicyPage());
    expect(screen.getByRole("main")).toHaveTextContent("el 50% o más, lo que ocurra primero");
    expect(screen.getByRole("main")).toHaveTextContent("una vez por curso");
    expect(screen.getByRole("main")).toHaveTextContent("siempre que la compra siga cumpliendo las condiciones de la Sección 1");
    expect(screen.getByRole("main")).toHaveTextContent("salvo cuando la ley lo exija");
    view.unmount();
    view = render(await TeacherTermsPage());
    expect(screen.getByRole("main")).toHaveTextContent("normalmente de 7 a 14 días, y hasta 30 días en Brasil");
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
