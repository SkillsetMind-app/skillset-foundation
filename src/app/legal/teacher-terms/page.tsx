import { LegalArticle, LegalSection, LegalText } from "@/components/site/legal-article";
import { refundWindowDays } from "@/data/plans";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("legalPages.teacherTerms.title"),
    description: t("legalPages.teacherTerms.description"),
    path: "/legal/teacher-terms",
  });
}

export default async function TeacherTermsPage() {
  const { t } = await getServerTranslation();
  // Blocks render in key order: text1..text27 top to bottom. The legal page
  // test compares the rendered order with that numbering.
  const text = (n: number) => (
    <LegalText
      text={t(`legalPages.teacherTerms.text${n}`)
        .replaceAll("{days}", () => String(refundWindowDays))}
    />
  );
  const heading = (n: number) => t(`legalPages.teacherTerms.heading${n}`);
  const paragraphs = (...ns: number[]) => ns.map((n) => <p key={n}>{text(n)}</p>);
  const list = (...ns: number[]) => (
    <ul className="list-disc space-y-2 pl-6">
      {ns.map((n) => <li key={n}>{text(n)}</li>)}
    </ul>
  );

  return (
    <LegalArticle
      kicker={t("legalPages.common.kicker")}
      title={t("legalPages.teacherTerms.title")}
      effectiveDate={t("legalPages.teacherTerms.effectiveDate")}
      effectiveLabel={t("legalPages.common.effectiveLabel")}
      intro={
        <>
          <p>{text(1)}</p>
          <p className="mt-3">{text(2)}</p>
        </>
      }
    >
      <LegalSection heading={heading(1)}>{paragraphs(3)}</LegalSection>
      <LegalSection heading={heading(2)}>{paragraphs(4, 5)}</LegalSection>
      <LegalSection heading={heading(3)}>{paragraphs(6, 7)}</LegalSection>
      <LegalSection heading={heading(4)}>{paragraphs(8, 9)}</LegalSection>
      <LegalSection heading={heading(5)}>
        {paragraphs(10)}
        {list(11, 12, 13, 14)}
      </LegalSection>
      <LegalSection heading={heading(6)}>{paragraphs(15, 16)}</LegalSection>
      <LegalSection heading={heading(7)}>{list(17, 18, 19, 20, 21)}</LegalSection>
      <LegalSection heading={heading(8)}>{paragraphs(22)}</LegalSection>
      <LegalSection heading={heading(9)}>{paragraphs(23)}</LegalSection>
      <LegalSection heading={heading(10)}>{paragraphs(24, 25)}</LegalSection>
      <LegalSection heading={heading(11)}>{paragraphs(26)}</LegalSection>
      <LegalSection heading={heading(12)}>{paragraphs(27)}</LegalSection>
    </LegalArticle>
  );
}
