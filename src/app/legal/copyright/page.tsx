import { LegalArticle, LegalSection, LegalText } from "@/components/site/legal-article";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("legalPages.copyright.title"),
    description: t("legalPages.copyright.description"),
    path: "/legal/copyright",
  });
}

export default async function CopyrightPage() {
  const { t } = await getServerTranslation();
  const text = (n: number) => <LegalText text={t(`legalPages.copyright.text${n}`)} />;
  const heading = (n: number) => t(`legalPages.copyright.heading${n}`);
  const list = (...ns: number[]) => (
    <ul className="list-disc space-y-2 pl-6">
      {ns.map((n) => <li key={n}>{text(n)}</li>)}
    </ul>
  );

  return (
    <LegalArticle
      kicker={t("legalPages.common.kicker")}
      title={t("legalPages.copyright.title")}
      effectiveDate={t("legalPages.common.effectiveDate")}
      effectiveLabel={t("legalPages.common.effectiveLabel")}
      intro={
        <>
          <p>{text(1)}</p>
          <p className="mt-3">{text(2)}</p>
        </>
      }
    >
      <LegalSection heading={heading(1)}>
        <p>{text(3)}</p>
        {list(4, 5, 6, 7, 8, 9)}
        <p>{text(10)}</p>
      </LegalSection>
      <LegalSection heading={heading(2)}>
        <p>{text(11)}</p>
      </LegalSection>
      <LegalSection heading={heading(3)}>
        <p>{text(12)}</p>
        {list(13, 14, 15, 16)}
        <p>{text(17)}</p>
      </LegalSection>
      <LegalSection heading={heading(4)}>
        <p>{text(18)}</p>
      </LegalSection>
      <LegalSection heading={heading(5)}>
        <p>{text(19)}</p>
      </LegalSection>
    </LegalArticle>
  );
}
